#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const failures = [];

function browserCandidates() {
  if (process.platform === "win32") {
    return [
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/chromium"];
}

let mcpManifest;
try {
  mcpManifest = require.resolve("@playwright/mcp/package.json");
  const version = JSON.parse(readFileSync(mcpManifest, "utf8")).version;
  if (version !== "0.0.79") failures.push(`expected @playwright/mcp@0.0.79, found ${version}`);
} catch (error) {
  failures.push(`Playwright MCP is not installed: ${error instanceof Error ? error.message : String(error)}`);
}

const browser = process.env.DSH_BROWSER_EXECUTABLE
  || browserCandidates().find((candidate) => candidate && existsSync(candidate));
if (!browser || !path.isAbsolute(browser) || !existsSync(browser)) {
  failures.push("no supported system Chrome, Edge or Chromium executable was found");
}

const runtimeArg = process.argv.indexOf("--runtime-root");
const runtime = runtimeArg >= 0 ? process.argv[runtimeArg + 1] : process.env.DSH_BROWSER_WORKBENCH_RUNTIME ?? process.env.DSH_HOME;
if (!runtime) failures.push("no runtime root: set DSH_BROWSER_WORKBENCH_RUNTIME or DSH_HOME");
else if (!path.isAbsolute(runtime)) failures.push("DSH_BROWSER_WORKBENCH_RUNTIME must be absolute");

for (const required of ["client.js", "agent.cordis.yml", "cordis.patch.yml", "lib/index.js"]) {
  if (!existsSync(path.join(root, required))) failures.push(`missing built artifact: ${required}`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL  ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS  @playwright/mcp@0.0.79\nPASS  ${browser}\nPASS  ${runtime}\n`);
}
