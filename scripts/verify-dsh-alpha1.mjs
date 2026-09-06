#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFlag = process.argv.indexOf("--source");
const sourceInput = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : process.env.DSH_ALPHA1_SOURCE;
if (!sourceInput) throw new Error("pass --source <built DeepSeek Harness Alpha1 checkout> or set DSH_ALPHA1_SOURCE");
const alphaRoot = path.resolve(sourceInput);
const cliManifest = path.join(alphaRoot, "apps", "cli", "package.json");
if (!existsSync(cliManifest)) throw new Error(`not a built DSH source checkout: ${alphaRoot}`);
const alphaRequire = createRequire(cliManifest);
const load = async (specifier) => await import(pathToFileURL(alphaRequire.resolve(specifier)).href);

const scratch = path.join(project, ".scratch", "dsh-alpha1-host");
const runtime = path.join(scratch, "runtime");
const workspace = path.join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

const [{ Context }, { default: SystemPrompt }, { default: ToolRuntime }, mcp, browserPlugin] = await Promise.all([
  load("@deepseek-ai/cordis"),
  load("@deepseek-ai/dsh-system-prompt"),
  load("@deepseek-ai/dsh-tools"),
  load("@deepseek-ai/dsh-mcp-client"),
  import("../lib/index.js"),
]);

const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  ctx.provide("sandboxPolicy", { resolve: () => ({ workspaceRoot: workspace }) });
  await ctx.plugin(browserPlugin, { runtimeRoot: runtime });
  const service = ctx.get("dshBrowserWorkbench");
  assert.ok(service, "browser Host service was not provided");

  await mcp.apply(ctx, {
    serverName: service.mcp.serverName,
    transport: service.mcp.transport,
    command: service.mcp.command,
    args: [...service.mcp.args],
    env: { ...service.mcp.env },
    cwd: service.mcp.cwd,
    toolCallTimeoutMs: service.mcp.toolCallTimeoutMs,
    failOnStartupError: true,
  });

  const unsafe = ctx.tools.get("mcp__browser__browser_run_code_unsafe");
  const screenshot = ctx.tools.get("mcp__browser__browser_take_screenshot");
  assert.ok(unsafe && screenshot, "official DSH MCP client did not register browser tools");
  const exec = {
    agent: { id: "alpha1-plugin-smoke", session: { id: "alpha1-plugin-smoke" } },
    signal: new AbortController().signal,
  };
  await unsafe.execute({
    code: "async (page) => { await page.setContent('<!doctype html><title>DSH Alpha1 plugin</title><main>host bridge</main>'); return await page.title(); }",
  }, exec);
  const frame = service.controller.snapshot("alpha1-plugin-smoke");
  assert.equal(frame.status, "ready");
  assert.ok(typeof frame.imageBase64 === "string" && frame.imageBase64.length > 100);

  await screenshot.execute({ filename: "artifacts/alpha1.png", scale: "css" }, exec);
  assert.ok(existsSync(path.join(workspace, "artifacts", "alpha1.png")));
  process.stdout.write("DSH Alpha1 Host integration: PASS (official dsh-mcp-client + plugin + Playwright + system browser)\n");
} finally {
  await ctx.fiber.dispose();
  rmSync(scratch, { recursive: true, force: true });
}
