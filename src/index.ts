/**
 * DSH Browser Workbench Host plugin.
 *
 * The package composes official DSH and Playwright pieces. It does not own an
 * MCP transport or browser protocol implementation.
 */

import { serveBrowserPanel, type BrowserPanelHost } from "./browser-panel.js";
import path from "node:path";
import {
  serveBrowserWorkbench,
  type BrowserWorkbenchConfig,
  type BrowserWorkbenchController,
  type BrowserWorkbenchHost,
} from "./browser-workbench.js";
import { createBrowserMcpDescriptor, type BrowserMcpDescriptor } from "./runtime.js";

export const name = "dsh-browser-workbench";
export const inject = ["tools", "sandboxPolicy"];

export interface Config extends Omit<BrowserWorkbenchConfig, "mcpOutputDir" | "serviceWorkersBlocked"> {
  readonly enabled?: boolean;
  /** Required absolute directory for all browser process state and staging. */
  readonly runtimeRoot?: string;
  /** Optional explicit Chrome/Edge/Chromium executable. */
  readonly browserExecutable?: string;
  /** Test/advanced override; normal installs resolve the pinned dependency. */
  readonly mcpEntry?: string;
  readonly viewport?: string;
  readonly toolCallTimeoutMs?: number;
}

export interface DshBrowserWorkbenchService {
  readonly mcp: BrowserMcpDescriptor;
  readonly controller: BrowserWorkbenchController;
}

interface PluginContext extends BrowserWorkbenchHost {
  provide(name: "dshBrowserWorkbench", value: DshBrowserWorkbenchService): void;
  inject(names: readonly string[], callback: (ctx: unknown) => void): unknown;
  readonly logger?: {
    info?(message: string): void;
    warn?(message: string): void;
  };
}

function note(ctx: PluginContext, message: string): void {
  (ctx.logger?.info ?? ctx.logger?.warn)?.call(ctx.logger, `dsh-browser-workbench: ${message}`);
}

/** Install the Host wrapper, runtime service and optional Web side-panel route. */
export function apply(ctx: PluginContext, config: Config = {}): (() => void) | void {
  if (config.enabled === false) return;
  const runtimeRoot = config.runtimeRoot
    ?? (process.env.DSH_HOME === undefined ? undefined : path.join(process.env.DSH_HOME, "browser-workbench"));
  if (runtimeRoot === undefined || runtimeRoot === "") {
    throw new Error("dsh-browser-workbench requires runtimeRoot or DSH_HOME");
  }
  const mcp = createBrowserMcpDescriptor({
    runtimeRoot,
    ...(config.browserExecutable === undefined ? {} : { browserExecutable: config.browserExecutable }),
    ...(config.mcpEntry === undefined ? {} : { mcpEntry: config.mcpEntry }),
    ...(config.viewport === undefined ? {} : { viewport: config.viewport }),
    ...(config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }),
  });
  const controller = serveBrowserWorkbench(ctx, {
    enabled: true,
    mcpOutputDir: mcp.outputDir,
    serviceWorkersBlocked: mcp.serviceWorkersBlocked,
    ...(config.liveCapture === undefined ? {} : { liveCapture: config.liveCapture }),
    ...(config.maxSessions === undefined ? {} : { maxSessions: config.maxSessions }),
    ...(config.maxFrameBytes === undefined ? {} : { maxFrameBytes: config.maxFrameBytes }),
    ...(config.maxStagedInputBytes === undefined ? {} : { maxStagedInputBytes: config.maxStagedInputBytes }),
  }, (message) => note(ctx, message));
  ctx.provide("dshBrowserWorkbench", { mcp, controller });

  let disposePanel = (): void => undefined;
  ctx.inject(["webServer"], (scoped) => {
    disposePanel();
    disposePanel = serveBrowserPanel(
      scoped as BrowserPanelHost,
      controller,
      (message) => note(ctx, message),
    );
  });

  return () => {
    disposePanel();
    controller.dispose();
  };
}

export type {
  BrowserPanelSnapshot,
  BrowserRequestPolicy,
  BrowserWorkbenchConfig,
  BrowserWorkbenchController,
} from "./browser-workbench.js";
export { createBrowserMcpDescriptor } from "./runtime.js";
