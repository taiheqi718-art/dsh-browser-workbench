/**
 * DSH Browser Workbench Host plugin.
 *
 * The package composes official DSH and Playwright pieces. It does not own an
 * MCP transport or browser protocol implementation.
 */
import { type BrowserWorkbenchConfig, type BrowserWorkbenchController, type BrowserWorkbenchHost } from "./browser-workbench.js";
import { type BrowserMcpDescriptor } from "./runtime.js";
export declare const name = "dsh-browser-workbench";
export declare const inject: string[];
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
/** Install the Host wrapper, runtime service and optional Web side-panel route. */
export declare function apply(ctx: PluginContext, config?: Config): (() => void) | void;
export type { BrowserPanelSnapshot, BrowserRequestPolicy, BrowserWorkbenchConfig, BrowserWorkbenchController, } from "./browser-workbench.js";
export { createBrowserMcpDescriptor } from "./runtime.js";
