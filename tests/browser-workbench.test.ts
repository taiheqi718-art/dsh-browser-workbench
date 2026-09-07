import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  serveBrowserWorkbench,
  type BrowserToolDefinition,
  type BrowserToolExecution,
} from "../src/browser-workbench.js";

const SCRATCH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".scratch",
);
mkdirSync(SCRATCH, { recursive: true });

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(path.join(SCRATCH, "browser-workbench-test-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const output = path.join(root, "browser-output");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(output, { recursive: true });
  const definitions = new Map<string, BrowserToolDefinition>();
  const tools = {
    register(definition: BrowserToolDefinition): () => void {
      definitions.set(definition.name, definition);
      return () => { definitions.delete(definition.name); };
    },
  };
  const notes: string[] = [];
  const controller = serveBrowserWorkbench({
    tools,
    sandboxPolicy: { resolve: () => ({ workspaceRoot: workspace }) },
  }, {
    enabled: true,
    mcpOutputDir: output,
    liveCapture: true,
    serviceWorkersBlocked: true,
  }, message => notes.push(message));
  const exec: BrowserToolExecution = {
    agent: { id: "session-1", session: { id: "session-1" } },
    signal: new AbortController().signal,
  };
  return { root, workspace, output, definitions, tools, notes, controller, exec };
}

function mcpText(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

describe("session-aware browser workbench", () => {
  it("stages explicit outputs and copies them into the calling workspace", async () => {
    const b = setup();
    let seen: Record<string, unknown> | undefined;
    b.tools.register({
      name: "mcp__browser__browser_take_screenshot",
      async execute(args) {
        seen = args as Record<string, unknown>;
        writeFileSync(seen.filename as string, "png-bytes");
        return mcpText(`- [Screenshot](../browser-output/${path.basename(seen.filename as string)})`);
      },
    });

    const result = await b.definitions.get("mcp__browser__browser_take_screenshot")?.execute({
      filename: "artifacts/page.png",
    }, b.exec) as { content: Array<{ type: string; text: string }> };

    expect(seen?._meta).toEqual({ cwd: b.workspace });
    expect(seen?.filename).not.toBe(path.join(b.workspace, "artifacts", "page.png"));
    expect(readFileSync(path.join(b.workspace, "artifacts", "page.png"), "utf8")).toBe("png-bytes");
    expect(result.content[0]?.text).toContain("artifacts/page.png");
    expect(result.content[0]?.text).not.toContain(".dsh-browser-");
    expect(existsSync(seen?.filename as string)).toBe(false);
  });

  it("refuses a named output outside the Session workspace before MCP executes", async () => {
    const b = setup();
    let called = false;
    b.tools.register({
      name: "mcp__browser__browser_snapshot",
      async execute() {
        called = true;
        return mcpText("unexpected");
      },
    });
    await expect(b.definitions.get("mcp__browser__browser_snapshot")?.execute({
      filename: "../escape.md",
    }, b.exec)).rejects.toThrow(/must stay inside/);
    expect(called).toBe(false);
  });

  it("stages upload inputs and removes the copy after the call", async () => {
    const b = setup();
    writeFileSync(path.join(b.workspace, "fixture.txt"), "fixture");
    let staged: string | undefined;
    b.tools.register({
      name: "mcp__browser__browser_file_upload",
      async execute(args) {
        staged = (args as { paths: string[] }).paths[0];
        expect(readFileSync(staged as string, "utf8")).toBe("fixture");
        return mcpText("uploaded");
      },
    });
    await b.definitions.get("mcp__browser__browser_file_upload")?.execute({ paths: ["fixture.txt"] }, b.exec);
    expect(staged).toContain(b.output);
    expect(existsSync(staged as string)).toBe(false);
  });

  it("captures a bounded model-invisible frame after a browser action", async () => {
    const b = setup();
    b.tools.register({
      name: "mcp__browser__browser_take_screenshot",
      async execute(args) {
        writeFileSync((args as { filename: string }).filename, "live-png");
        return mcpText("captured internally");
      },
    });
    b.tools.register({
      name: "mcp__browser__browser_navigate",
      async execute() {
        return mcpText("- Page URL: https://example.test/demo");
      },
    });

    const activity = b.controller.waitSnapshot("session-1", 0, 1_000);
    const modelResult = await b.definitions.get("mcp__browser__browser_navigate")?.execute({
      url: "https://example.test/demo",
    }, b.exec);
    expect(modelResult).toEqual(mcpText("- Page URL: https://example.test/demo"));

    const woke = await activity;
    expect(woke.status).toBe("working");
    expect(woke.activity).toBe(1);

    const first = b.controller.snapshot("session-1", 0);
    expect(first.status).toBe("ready");
    expect(first.activity).toBe(1);
    expect(first.url).toBe("https://example.test/demo");
    expect(Buffer.from(first.imageBase64 as string, "base64").toString()).toBe("live-png");
    const unchanged = b.controller.snapshot("session-1", first.revision);
    expect(unchanged).not.toHaveProperty("imageBase64");
  });

  it("previews a Session-local file over a tokenized loopback URL without enabling file access", async () => {
    const b = setup();
    writeFileSync(path.join(b.workspace, "index.html"), '<link rel="stylesheet" href="style.css"><h1>local</h1>');
    writeFileSync(path.join(b.workspace, "style.css"), "h1{color:teal}");
    let seenUrl = "";
    b.tools.register({
      name: "mcp__browser__browser_navigate",
      async execute(args) {
        seenUrl = (args as { url: string }).url;
        const page = await fetch(seenUrl);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("<h1>local</h1>");
        const asset = await fetch(new URL("style.css", seenUrl));
        expect(asset.status).toBe(200);
        expect(await asset.text()).toBe("h1{color:teal}");
        return mcpText(`- Page URL: ${seenUrl}`);
      },
    });

    await b.definitions.get("mcp__browser__browser_navigate")?.execute({
      url: pathToFileURL(path.join(b.workspace, "index.html")).href,
    }, b.exec);
    expect(seenUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\/index\.html$/);
    expect(seenUrl).not.toContain("file:");
    expect(b.controller.snapshot("session-1").url).toBe("workspace/index.html");
    b.controller.dispose();
  });

  it("refuses a file preview outside the calling Session workspace", async () => {
    const b = setup();
    const outside = path.join(b.root, "outside.html");
    writeFileSync(outside, "outside");
    let called = false;
    b.tools.register({
      name: "mcp__browser__browser_navigate",
      async execute() {
        called = true;
        return mcpText("unexpected");
      },
    });
    await expect(b.definitions.get("mcp__browser__browser_navigate")?.execute({
      url: pathToFileURL(outside).href,
    }, b.exec)).rejects.toThrow(/must stay inside/);
    expect(called).toBe(false);
  });

  it("describes unsafe browser code as page JavaScript rather than a Node shell", () => {
    const b = setup();
    b.tools.register({
      name: "mcp__browser__browser_run_code_unsafe",
      description: "Run code.",
      async execute() { return mcpText("done"); },
    });
    const description = b.definitions.get("mcp__browser__browser_run_code_unsafe")?.description;
    expect(description).toContain("not a Node.js shell");
    expect(description).toContain("Use the shell tool");
  });

  it("installs an exact-origin request fence before a policy-bound browser action", async () => {
    const b = setup();
    const order: string[] = [];
    let policyCode = "";
    b.tools.register({
      name: "mcp__browser__browser_run_code_unsafe",
      async execute(args) {
        order.push("policy");
        policyCode = (args as { code: string }).code;
        const marker = /return\s+"(DSH_BROWSER_WORKBENCH_REQUEST_POLICY_[^"]+)"/.exec(policyCode)?.[1];
        return mcpText(marker ?? "missing marker");
      },
    });
    b.tools.register({
      name: "mcp__browser__browser_navigate",
      async execute() {
        order.push("navigate");
        return mcpText("- Page URL: https://allowed.example/app");
      },
    });
    b.controller.setRequestPolicy("session-1", { allowedOrigins: ["https://allowed.example/path"] });

    await b.definitions.get("mcp__browser__browser_navigate")?.execute({
      url: "https://allowed.example/app",
    }, b.exec);

    expect(order).toEqual(["policy", "navigate"]);
    expect(policyCode).toContain('new Set(["https://allowed.example"])');
    expect(policyCode).toContain('context.route("**/*"');
    expect(policyCode).toContain('context.routeWebSocket("**/*"');
    expect(policyCode).toContain('route.abort("blockedbyclient")');

    let requestHandler: ((route: {
      request(): { url(): string };
      continue(): Promise<void>;
      abort(reason: string): Promise<void>;
    }) => Promise<void>) | undefined;
    let socketHandler: ((socket: { close(options: { code: number; reason: string }): Promise<void> }) => Promise<void>) | undefined;
    const fakeContext = {
      route: async (_pattern: string, handler: typeof requestHandler) => { requestHandler = handler; },
      routeWebSocket: async (_pattern: string, handler: typeof socketHandler) => { socketHandler = handler; },
      addInitScript: async () => undefined,
    };
    const install = (0, eval)(`(${policyCode})`) as (page: { context(): typeof fakeContext }) => Promise<string>;
    await install({ context: () => fakeContext });

    const events: string[] = [];
    await requestHandler?.({
      request: () => ({ url: () => "https://allowed.example/redirect-target" }),
      continue: async () => { events.push("continued"); },
      abort: async () => { events.push("unexpected-abort"); },
    });
    await requestHandler?.({
      request: () => ({ url: () => "https://forbidden.example/exfiltrate" }),
      continue: async () => { events.push("unexpected-continue"); },
      abort: async reason => { events.push(`aborted:${reason}`); },
    });
    await socketHandler?.({
      close: async options => { events.push(`socket:${options.code}`); },
    });
    expect(events).toEqual(["continued", "aborted:blockedbyclient", "socket:1008"]);
  });

  it("fails closed when a policy-bound Session lacks the trusted installer tool", async () => {
    const b = setup();
    let called = false;
    b.tools.register({
      name: "mcp__browser__browser_navigate",
      async execute() {
        called = true;
        return mcpText("unexpected");
      },
    });
    b.controller.setRequestPolicy("session-1", { allowedOrigins: ["https://allowed.example"] });
    await expect(b.definitions.get("mcp__browser__browser_navigate")?.execute({
      url: "https://allowed.example",
    }, b.exec)).rejects.toThrow(/cannot be enforced/);
    expect(called).toBe(false);
  });

  it("prevents model-visible tools from removing an active host request fence", async () => {
    const b = setup();
    let unsafeCalled = false;
    let unrouteCalled = false;
    b.tools.register({
      name: "mcp__browser__browser_run_code_unsafe",
      async execute() {
        unsafeCalled = true;
        return mcpText("unsafe");
      },
    });
    b.tools.register({
      name: "mcp__browser__browser_unroute",
      async execute() {
        unrouteCalled = true;
        return mcpText("unrouted");
      },
    });
    b.controller.setRequestPolicy("session-1", { allowedOrigins: ["https://allowed.example"] });

    await expect(b.definitions.get("mcp__browser__browser_run_code_unsafe")?.execute({
      code: "async page => page.context().unrouteAll()",
    }, b.exec)).rejects.toThrow(/disabled/);
    await expect(b.definitions.get("mcp__browser__browser_unroute")?.execute({}, b.exec)).rejects.toThrow(/disabled/);
    expect(unsafeCalled).toBe(false);
    expect(unrouteCalled).toBe(false);
  });

  it("increments panel activity once per external browser call and closes on browser_close", async () => {
    const b = setup();
    b.tools.register({
      name: "mcp__browser__browser_close",
      async execute() { return mcpText("closed"); },
    });
    const initial = b.controller.snapshot("session-1");
    expect(initial).toMatchObject({ status: "idle", revision: 0, activity: 0 });

    const closeActivity = b.controller.waitSnapshot("session-1", 0, 1_000);
    await b.definitions.get("mcp__browser__browser_close")?.execute({}, b.exec);
    expect(await closeActivity).toMatchObject({ status: "idle", activity: 1 });
    expect(b.controller.snapshot("session-1")).toMatchObject({ status: "idle", activity: 1 });
  });

  it("restores the original register method on disposal", () => {
    const b = setup();
    b.controller.dispose();
    expect(Object.prototype.hasOwnProperty.call(b.tools, "register")).toBe(true);
    expect(b.notes.join("\n")).toContain("browser workbench armed");
  });
});
