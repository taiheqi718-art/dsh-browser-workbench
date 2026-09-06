/** Runtime descriptor consumed by the official DSH MCP client row. */
export declare const PLAYWRIGHT_MCP_VERSION = "0.0.79";
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
/**
 * Resolve all machine-specific paths once on the Host. Agent presets consume
 * this service instead of duplicating paths or invoking npx at task time.
 */
export declare function createBrowserMcpDescriptor(config: BrowserRuntimeConfig): BrowserMcpDescriptor;
