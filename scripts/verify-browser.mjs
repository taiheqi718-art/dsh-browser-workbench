#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serveBrowserWorkbench } from "../lib/browser-workbench.js";
import { createBrowserMcpDescriptor } from "../lib/runtime.js";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(project, ".scratch", "real-browser");
const runtimeRoot = path.join(scratch, "runtime");
const workspace = path.join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

const descriptor = createBrowserMcpDescriptor({ runtimeRoot });
const client = new Client({ name: "dsh-browser-workbench-smoke", version: "1" });
const transport = new StdioClientTransport({
  command: descriptor.command,
  args: [...descriptor.args],
  cwd: descriptor.cwd,
  env: { ...process.env, ...descriptor.env },
});

const definitions = new Map();
const tools = {
  register(definition) {
    definitions.set(definition.name, definition);
    return () => definitions.delete(definition.name);
  },
};
const controller = serveBrowserWorkbench({
  tools,
  sandboxPolicy: { resolve: () => ({ workspaceRoot: workspace }) },
}, {
  enabled: true,
  mcpOutputDir: descriptor.outputDir,
  serviceWorkersBlocked: true,
  liveCapture: true,
}, () => undefined);

const exec = {
  agent: { id: "smoke-session", session: { id: "smoke-session" } },
  signal: new AbortController().signal,
};

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const required = new Set(["browser_run_code_unsafe", "browser_take_screenshot", "browser_close"]);
  for (const tool of listed.tools) {
    if (!required.has(tool.name)) continue;
    tools.register({
      name: `mcp__browser__${tool.name}`,
      description: tool.description ?? "",
      async execute(args, toolExec) {
        return await client.callTool(
          { name: tool.name, arguments: args },
          undefined,
          { signal: toolExec.signal },
        );
      },
    });
  }
  for (const name of required) assert.ok(definitions.has(`mcp__browser__${name}`), `missing ${name}`);

  const run = definitions.get("mcp__browser__browser_run_code_unsafe");
  const result = await run.execute({
    code: "async (page) => { await page.setContent('<!doctype html><title>DSH Browser Workbench</title><button id=go>ready</button>'); await page.click('#go'); return await page.title(); }",
  }, exec);
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const live = controller.snapshot("smoke-session");
  assert.equal(live.status, "ready");
  assert.ok(typeof live.imageBase64 === "string" && live.imageBase64.length > 100, "live frame missing");

  const screenshot = definitions.get("mcp__browser__browser_take_screenshot");
  const saved = await screenshot.execute({ filename: "artifacts/page.png", scale: "css" }, exec);
  assert.notEqual(saved.isError, true, JSON.stringify(saved));
  assert.ok(existsSync(path.join(workspace, "artifacts", "page.png")), "workspace screenshot missing");
  assert.ok(readdirSync(path.join(workspace, "artifacts")).includes("page.png"));
  writeFileSync(path.join(workspace, "PASS"), "real browser chain passed\n");

  process.stdout.write("real browser chain: PASS (official MCP wire + system browser + Session fence + hidden frame)\n");
} finally {
  controller.dispose();
  await client.close().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
}
