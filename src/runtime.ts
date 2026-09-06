/** Runtime descriptor consumed by the official DSH MCP client row. */

import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
export const PLAYWRIGHT_MCP_VERSION = "0.0.79";

export interface BrowserRuntimeConfig {
  readonly runtimeRoot: string;
  readonly browserExecutable?: string;
  readonly mcpEntry?: string;
  readonly viewport?: string;
  readonly toolCallTimeoutMs?: number;
}

export interface BrowserMcpDescriptor {
  readonly serverName: "browser";
  readonly transport: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly outputDir: string;
  readonly toolCallTimeoutMs: number;
  readonly serviceWorkersBlocked: true;
}

function browserCandidates(): readonly (string | undefined)[] {
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

function locateMcpEntry(override?: string): string {
  if (override !== undefined) return path.resolve(override);
  const manifest = require.resolve("@playwright/mcp/package.json");
  return path.join(path.dirname(manifest), "cli.js");
}

function requireAbsoluteExisting(label: string, candidate: string): string {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) {
    throw new Error(`${label} must be an existing absolute path: ${candidate}`);
  }
  return candidate;
}

/**
 * Resolve all machine-specific paths once on the Host. Agent presets consume
 * this service instead of duplicating paths or invoking npx at task time.
 */
export function createBrowserMcpDescriptor(config: BrowserRuntimeConfig): BrowserMcpDescriptor {
  if (!path.isAbsolute(config.runtimeRoot)) {
    throw new Error(`browser runtimeRoot must be absolute: ${config.runtimeRoot}`);
  }
  const runtimeRoot = path.resolve(config.runtimeRoot);
  const outputDir = path.join(runtimeRoot, "output");
  const home = path.join(runtimeRoot, "home");
  const temp = path.join(runtimeRoot, "temp");
  const cache = path.join(runtimeRoot, "cache");
  for (const directory of [runtimeRoot, outputDir, home, temp, cache]) {
    mkdirSync(directory, { recursive: true });
  }

  const executable = requireAbsoluteExisting(
    "browser executable",
    config.browserExecutable
      ?? browserCandidates().find((candidate): candidate is string => candidate !== undefined && existsSync(candidate))
      ?? "",
  );
  const mcpEntry = requireAbsoluteExisting("Playwright MCP entry", locateMcpEntry(config.mcpEntry));
  const viewport = config.viewport ?? "1440x900";
  if (!/^\d{2,5}x\d{2,5}$/.test(viewport)) throw new Error(`invalid browser viewport: ${viewport}`);

  return {
    serverName: "browser",
    transport: "stdio",
    command: process.execPath,
    args: [
      mcpEntry,
      "--executable-path", executable,
      "--isolated",
      "--block-service-workers",
      "--headless",
      "--output-dir", outputDir,
      "--output-max-size", "268435456",
      "--image-responses", "allow",
      "--viewport-size", viewport,
    ],
    env: {
      PLAYWRIGHT_BROWSERS_PATH: cache,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: home,
      APPDATA: home,
      XDG_CACHE_HOME: cache,
      XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home,
      TMP: temp,
      TEMP: temp,
      TMPDIR: temp,
    },
    cwd: runtimeRoot,
    outputDir,
    toolCallTimeoutMs: Math.max(1_000, config.toolCallTimeoutMs ?? 120_000),
    serviceWorkersBlocked: true,
  };
}
