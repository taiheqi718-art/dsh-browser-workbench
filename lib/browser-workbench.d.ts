/**
 * Session-aware browser workbench around the official DSH MCP bridge.
 *
 * This module deliberately does not implement MCP. The official
 * `@deepseek-ai/dsh-mcp-client` still owns discovery, reconnect, transport,
 * validation and result projection; Microsoft's Playwright MCP still owns the
 * browser. We wrap only the registered `mcp__browser__*` definitions to add
 * the two pieces neither upstream currently supplies:
 *
 *   - bind filesystem arguments to the calling Session's workspace, including
 *     workspaces outside the MCP process' fixed cwd;
 *   - keep one bounded, model-invisible live frame for the native side panel.
 *
 * The hidden `_meta.cwd` field is consumed by Playwright MCP before its public
 * input schema is parsed, so it is never added to the model-visible schema.
 * Explicit outputs are written to the MCP output directory first, then copied
 * through a symlink-aware workspace fence. We never enable Playwright MCP's
 * unrestricted file-access switch.
 *
 * @module browser/workbench
 */
/** The tiny ToolDefinition face used without coupling the shared bundle to alpha.1 types. */
export interface BrowserToolDefinition {
    readonly name: string;
    readonly [key: string]: unknown;
    execute(args: unknown, exec: BrowserToolExecution): Promise<unknown>;
}
/** The execution fields this adapter consumes. */
export interface BrowserToolExecution {
    readonly agent?: {
        readonly id?: string;
        readonly session?: unknown;
    };
    readonly signal: AbortSignal;
    readonly [key: string]: unknown;
}
/** Structural host face, keeping this module detachable from one DSH prerelease. */
export interface BrowserWorkbenchHost {
    readonly tools: {
        register(definition: BrowserToolDefinition): () => void;
        readonly ctx?: object;
    };
    readonly sandboxPolicy: {
        resolve(request?: {
            readonly session?: unknown;
        }): {
            readonly workspaceRoot: string;
        };
    };
}
export interface BrowserWorkbenchConfig {
    readonly enabled?: boolean;
    /** Fixed `--output-dir` passed to Playwright MCP. Must be absolute. */
    readonly mcpOutputDir?: string;
    /** True only when the MCP process was launched with --block-service-workers. */
    readonly serviceWorkersBlocked?: boolean;
    readonly liveCapture?: boolean;
    readonly maxSessions?: number;
    readonly maxFrameBytes?: number;
    readonly maxStagedInputBytes?: number;
}
/** A route-safe snapshot. Image bytes are returned only when the caller is behind. */
export interface BrowserPanelSnapshot {
    readonly status: "idle" | "working" | "ready" | "error";
    readonly revision: number;
    /** Increments once per model-visible browser tool call, not per frame refresh. */
    readonly activity: number;
    readonly updatedAt: string | null;
    readonly url: string | null;
    readonly error: string | null;
    readonly mimeType?: "image/png" | "image/jpeg" | "image/webp";
    readonly imageBase64?: string;
}
export interface BrowserRequestPolicy {
    /** Exact HTTP(S) origins allowed to leave this browser context. */
    readonly allowedOrigins: readonly string[];
    /** Explicit host revocation. An accidentally empty allowlist remains invalid. */
    readonly blockAll?: boolean;
}
/** Public controller used by the host route and lifecycle disposer. */
export interface BrowserWorkbenchController {
    snapshot(sessionId: string, afterRevision?: number): BrowserPanelSnapshot;
    /** Wait for a changed revision, allowing a hidden UI to avoid fixed-rate polling. */
    waitSnapshot(sessionId: string, afterRevision: number, timeoutMs: number): Promise<BrowserPanelSnapshot>;
    /**
     * Install or clear a host-owned request policy for one Session.
     *
     * Once present, the policy is applied inside Playwright before every external
     * browser operation. Model-visible unsafe-code and route-management tools are
     * then refused so the page cannot remove the host route through another tool.
     */
    setRequestPolicy(sessionId: string, policy: BrowserRequestPolicy | null): void;
    dispose(): void;
}
/**
 * Install the reversible tool-registration adapter.
 *
 * The replacement is a normal function on purpose. Cordis' traceable Service
 * proxy supplies the caller's scoped Context as `this.ctx`; an arrow function
 * would collapse every Agent's MCP registrations into the root scope.
 */
export declare function serveBrowserWorkbench(host: BrowserWorkbenchHost, config: BrowserWorkbenchConfig, note: (message: string) => void): BrowserWorkbenchController;
