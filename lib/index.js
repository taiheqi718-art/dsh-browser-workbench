/**
 * DSH Browser Workbench Host plugin.
 *
 * The package composes official DSH and Playwright pieces. It does not own an
 * MCP transport or browser protocol implementation.
 */
import { serveBrowserPanel } from "./browser-panel.js";
import path from "node:path";
import { serveBrowserWorkbench, } from "./browser-workbench.js";
import { createBrowserMcpDescriptor } from "./runtime.js";
export const name = "dsh-browser-workbench";
export const inject = ["tools", "sandboxPolicy"];
function note(ctx, message) {
    (ctx.logger?.info ?? ctx.logger?.warn)?.call(ctx.logger, `dsh-browser-workbench: ${message}`);
}
/** Install the Host wrapper, runtime service and optional Web side-panel route. */
export function apply(ctx, config = {}) {
    if (config.enabled === false)
        return;
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
    let disposePanel = () => undefined;
    ctx.inject(["webServer"], (scoped) => {
        disposePanel();
        disposePanel = serveBrowserPanel(scoped, controller, (message) => note(ctx, message));
    });
    return () => {
        disposePanel();
        controller.dispose();
    };
}
export { createBrowserMcpDescriptor } from "./runtime.js";
//# sourceMappingURL=index.js.map