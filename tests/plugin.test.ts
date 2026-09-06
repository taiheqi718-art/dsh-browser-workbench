import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apply, type DshBrowserWorkbenchService } from "../src/index.js";
import type { BrowserToolDefinition } from "../src/browser-workbench.js";

const scratch = path.resolve(".scratch");
mkdirSync(scratch, { recursive: true });
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("DSH Host plugin", () => {
  it("provides one reusable MCP descriptor without mounting a private Harness", () => {
    const runtimeRoot = mkdtempSync(path.join(scratch, "plugin-"));
    roots.push(runtimeRoot);
    let provided: DshBrowserWorkbenchService | undefined;
    const definitions = new Map<string, BrowserToolDefinition>();
    const tools = {
      register(definition: BrowserToolDefinition): () => void {
        definitions.set(definition.name, definition);
        return () => definitions.delete(definition.name);
      },
    };
    const context = {
      tools,
      sandboxPolicy: { resolve: () => ({ workspaceRoot: runtimeRoot }) },
      provide(_name: "dshBrowserWorkbench", value: DshBrowserWorkbenchService) { provided = value; },
      inject() { return undefined; },
    };
    const dispose = apply(context, {
      runtimeRoot,
      browserExecutable: process.execPath,
      mcpEntry: process.execPath,
      liveCapture: false,
    });

    expect(provided?.mcp.serverName).toBe("browser");
    expect(provided?.mcp.outputDir).toMatch(/[\\/]output$/);
    expect(provided?.controller.snapshot("none").status).toBe("idle");
    expect(dispose).toBeTypeOf("function");
    dispose?.();
  });

  it("stays inert when explicitly disabled", () => {
    let provided = false;
    const context = {
      tools: { register: () => () => undefined },
      sandboxPolicy: { resolve: () => ({ workspaceRoot: process.cwd() }) },
      provide() { provided = true; },
      inject() { return undefined; },
    };
    expect(apply(context, { enabled: false })).toBeUndefined();
    expect(provided).toBe(false);
  });
});
