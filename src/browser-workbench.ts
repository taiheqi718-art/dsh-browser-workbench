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

import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside, resolveTarget } from "./path-security.js";
import { createWorkspacePreviewBridge } from "./workspace-preview.js";

const BROWSER_PREFIX = "mcp__browser__";
const SCREENSHOT_TOOL = `${BROWSER_PREFIX}browser_take_screenshot`;
const VIDEO_START_TOOL = `${BROWSER_PREFIX}browser_start_video`;
const VIDEO_STOP_TOOL = `${BROWSER_PREFIX}browser_stop_video`;
const NAVIGATE_TOOL = `${BROWSER_PREFIX}browser_navigate`;
const UNSAFE_CODE_TOOL = `${BROWSER_PREFIX}browser_run_code_unsafe`;

/** Tools whose `filename` is an immediate output, not an input. */
const OUTPUT_FILENAME_TOOLS = new Set([
  `${BROWSER_PREFIX}browser_snapshot`,
  SCREENSHOT_TOOL,
  `${BROWSER_PREFIX}browser_console_messages`,
  `${BROWSER_PREFIX}browser_evaluate`,
  `${BROWSER_PREFIX}browser_network_requests`,
  `${BROWSER_PREFIX}browser_network_request`,
  `${BROWSER_PREFIX}browser_pdf_save`,
  `${BROWSER_PREFIX}browser_storage_state`,
]);

/** Tools whose `filename` is read by the Playwright MCP process. */
const INPUT_FILENAME_TOOLS = new Set([
  `${BROWSER_PREFIX}browser_run_code_unsafe`,
  `${BROWSER_PREFIX}browser_set_storage_state`,
]);

/** Tools whose `paths` array names workspace files sent into the page. */
const INPUT_PATHS_TOOLS = new Set([
  `${BROWSER_PREFIX}browser_file_upload`,
  `${BROWSER_PREFIX}browser_drop`,
]);

/** Page-changing calls after which the UI should get a fresh frame. */
const CAPTURE_AFTER = new Set([
  `${BROWSER_PREFIX}browser_navigate`,
  `${BROWSER_PREFIX}browser_navigate_back`,
  `${BROWSER_PREFIX}browser_click`,
  `${BROWSER_PREFIX}browser_drag`,
  `${BROWSER_PREFIX}browser_hover`,
  `${BROWSER_PREFIX}browser_type`,
  `${BROWSER_PREFIX}browser_select_option`,
  `${BROWSER_PREFIX}browser_press_key`,
  `${BROWSER_PREFIX}browser_fill_form`,
  `${BROWSER_PREFIX}browser_file_upload`,
  `${BROWSER_PREFIX}browser_drop`,
  `${BROWSER_PREFIX}browser_handle_dialog`,
  `${BROWSER_PREFIX}browser_resize`,
  `${BROWSER_PREFIX}browser_tabs`,
  `${BROWSER_PREFIX}browser_route`,
  `${BROWSER_PREFIX}browser_unroute`,
  `${BROWSER_PREFIX}browser_set_storage_state`,
  `${BROWSER_PREFIX}browser_network_state_set`,
  `${BROWSER_PREFIX}browser_cookie_set`,
  `${BROWSER_PREFIX}browser_cookie_delete`,
  `${BROWSER_PREFIX}browser_cookie_clear`,
  `${BROWSER_PREFIX}browser_evaluate`,
  `${BROWSER_PREFIX}browser_run_code_unsafe`,
  `${BROWSER_PREFIX}browser_wait_for`,
  `${BROWSER_PREFIX}browser_highlight`,
  `${BROWSER_PREFIX}browser_hide_highlight`,
]);

const CLOSE_TOOL = `${BROWSER_PREFIX}browser_close`;
const DEFAULT_MAX_SESSIONS = 12;
const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STAGED_INPUT_BYTES = 64 * 1024 * 1024;

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
    resolve(request?: { readonly session?: unknown }): { readonly workspaceRoot: string };
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

interface FrameState {
  status: BrowserPanelSnapshot["status"];
  revision: number;
  activity: number;
  updatedAt: string;
  url: string | null;
  error: string | null;
  mimeType: BrowserPanelSnapshot["mimeType"] | undefined;
  image: Buffer | undefined;
  accessedAt: number;
}

interface PendingVideo {
  readonly staged: string;
  readonly target: string;
  readonly display: string;
}

interface RegistrationGroup {
  screenshot?: BrowserToolDefinition;
  unsafeCode?: BrowserToolDefinition;
}

export interface BrowserRequestPolicy {
  /** Exact HTTP(S) origins allowed to leave this browser context. */
  readonly allowedOrigins: readonly string[];
  /** Explicit host revocation. An accidentally empty allowlist remains invalid. */
  readonly blockAll?: boolean;
}

interface OutputStage {
  readonly staged: string;
  readonly target: string;
  readonly display: string;
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

interface SnapshotWaiter {
  readonly afterRevision: number;
  readonly resolve: (snapshot: BrowserPanelSnapshot) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown browser error";
}

function extensionFor(tool: string, requested: string): string {
  const ext = path.extname(requested);
  if (ext !== "") return ext;
  if (tool.endsWith("browser_pdf_save")) return ".pdf";
  if (tool.endsWith("browser_snapshot")) return ".md";
  if (tool.endsWith("browser_console_messages") || tool.includes("browser_network")) return ".log";
  if (tool.endsWith("browser_storage_state")) return ".json";
  return ".png";
}

function sessionIdOf(exec: BrowserToolExecution): string | undefined {
  const id = exec.agent?.id;
  if (typeof id === "string" && id !== "") return id;
  const session = exec.agent?.session as { readonly id?: unknown } | undefined;
  return typeof session?.id === "string" && session.id !== "" ? session.id : undefined;
}

function replaceFileResult(value: unknown, stage: OutputStage): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.content)) return value;
  const basename = path.basename(stage.staged);
  const content = result.content.map((block): unknown => {
    if (typeof block !== "object" || block === null || Array.isArray(block)) return block;
    const item = block as Record<string, unknown>;
    if (item.type !== "text" || typeof item.text !== "string") return block;
    const kept = item.text.split(/\r?\n/).filter(line => !line.includes(basename));
    kept.push(`- [Saved file](${stage.display.replaceAll("\\", "/")})`);
    return { ...item, text: kept.join("\n") };
  });
  return { ...result, content };
}

function pageUrlOf(value: unknown): string | undefined {
  const result = recordOf(value);
  if (!Array.isArray(result.content)) return undefined;
  for (const block of result.content) {
    const item = recordOf(block);
    if (item.type !== "text" || typeof item.text !== "string") continue;
    const match = /^- Page URL:\s*(\S.*)$/m.exec(item.text);
    if (match?.[1] !== undefined) return match[1].trim().slice(0, 2048);
  }
  return undefined;
}

function imageOf(value: unknown): { mimeType: BrowserPanelSnapshot["mimeType"]; bytes: Buffer } | undefined {
  const result = recordOf(value);
  if (!Array.isArray(result.content)) return undefined;
  for (const block of result.content) {
    const item = recordOf(block);
    if (item.type !== "image" || typeof item.data !== "string") continue;
    if (item.mimeType !== "image/png" && item.mimeType !== "image/jpeg" && item.mimeType !== "image/webp") continue;
    return { mimeType: item.mimeType, bytes: Buffer.from(item.data, "base64") };
  }
  return undefined;
}

function normalizeRequestPolicy(policy: BrowserRequestPolicy): BrowserRequestPolicy {
  const origins = [...new Set(policy.allowedOrigins.map((value) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`browser request policy supports only HTTP(S) origins: ${value}`);
    }
    if (parsed.username !== "" || parsed.password !== "") {
      throw new Error("browser request policy forbids URL credentials");
    }
    return parsed.origin;
  }))].sort();
  if (policy.blockAll === true && origins.length !== 0) throw new Error("blockAll cannot also allow origins");
  if (origins.length === 0 && policy.blockAll !== true) throw new Error("browser request policy requires at least one exact origin");
  return { allowedOrigins: origins, ...(policy.blockAll === true ? {blockAll:true} : {}) };
}

function policyInstallerCode(allowedOrigins: readonly string[], marker: string): string {
  // This trusted string is generated solely from normalized host configuration;
  // no model text or page content is interpolated into executable code.
  const origins = JSON.stringify(allowedOrigins);
  const proof = JSON.stringify(marker);
  return `async (page) => {
    const context = page.context();
    const key = Symbol.for("dsh-browser-workbench.request-policy.v1");
    let state = context[key];
    if (!state) {
      state = { allowed: new Set() };
      Object.defineProperty(context, key, { value: state, configurable: false });
      await context.route("**/*", async route => {
        // Playwright supplies a canonical absolute URL. Its MCP evaluation
        // realm does not supply the Node URL constructor; match the complete
        // normalized authority plus a slash, never an unbounded host prefix.
        const url = route.request().url();
        const allowed = [...state.allowed].some(origin => url === origin || url.startsWith(origin + "/"));
        if (allowed) await route.continue();
        else await route.abort("blockedbyclient");
      });
      if (typeof context.routeWebSocket !== "function") throw new Error("Playwright WebSocket routing is unavailable");
      await context.routeWebSocket("**/*", socket => socket.close({ code: 1008, reason: "browser request policy" }));
      await context.addInitScript(() => {
        const container = globalThis.navigator?.serviceWorker;
        if (container) Object.defineProperty(container, "register", {
          configurable: false,
          writable: false,
          value: () => Promise.reject(new Error("service workers are disabled by browser request policy")),
        });
      });
    }
    state.allowed = new Set(${origins});
    return ${proof};
  }`;
}

function containsText(value: unknown, expected: string): boolean {
  const result = recordOf(value);
  return Array.isArray(result.content) && result.content.some((block) => {
    const item = recordOf(block);
    return item.type === "text" && typeof item.text === "string" && item.text.includes(expected);
  });
}

/**
 * Install the reversible tool-registration adapter.
 *
 * The replacement is a normal function on purpose. Cordis' traceable Service
 * proxy supplies the caller's scoped Context as `this.ctx`; an arrow function
 * would collapse every Agent's MCP registrations into the root scope.
 */
export function serveBrowserWorkbench(
  host: BrowserWorkbenchHost,
  config: BrowserWorkbenchConfig,
  note: (message: string) => void,
): BrowserWorkbenchController {
  if (config.enabled === false) {
    return {
      snapshot: () => ({ status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null }),
      waitSnapshot: async () => ({ status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null }),
      setRequestPolicy: () => undefined,
      dispose: () => undefined,
    };
  }
  const outputDir = config.mcpOutputDir;
  if (outputDir === undefined || !path.isAbsolute(outputDir)) {
    throw new Error("browser workbench requires an absolute mcpOutputDir matching Playwright MCP --output-dir");
  }
  const maxSessions = Math.max(1, config.maxSessions ?? DEFAULT_MAX_SESSIONS);
  const maxFrameBytes = Math.max(1024, config.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
  const maxStagedInputBytes = Math.max(1024, config.maxStagedInputBytes ?? DEFAULT_MAX_STAGED_INPUT_BYTES);
  const liveCapture = config.liveCapture !== false;
  const frames = new Map<string, FrameState>();
  const pendingVideos = new Map<string, PendingVideo>();
  const stagedFiles = new Set<string>();
  const waiters = new Map<string, Set<SnapshotWaiter>>();
  const groups = new WeakMap<object, RegistrationGroup>();
  const requestPolicies = new Map<string, BrowserRequestPolicy>();
  const workspacePreview = createWorkspacePreviewBridge(maxStagedInputBytes);
  let revision = 0;
  let disposed = false;

  const touch = (sessionId: string, patch: Partial<FrameState>): FrameState => {
    const previous = frames.get(sessionId);
    const next: FrameState = {
      status: previous?.status ?? "idle",
      revision: ++revision,
      activity: previous?.activity ?? 0,
      updatedAt: new Date().toISOString(),
      url: previous?.url ?? null,
      error: previous?.error ?? null,
      accessedAt: Date.now(),
      mimeType: previous?.mimeType,
      image: previous?.image,
      ...patch,
    };
    frames.delete(sessionId);
    frames.set(sessionId, next);
    while (frames.size > maxSessions) {
      const oldest = frames.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      frames.delete(oldest);
    }
    const pending = waiters.get(sessionId);
    if (pending !== undefined) {
      for (const waiter of [...pending]) {
        if (waiter.afterRevision === next.revision) continue;
        clearTimeout(waiter.timer);
        pending.delete(waiter);
        waiter.resolve(snapshotOf(sessionId, waiter.afterRevision));
      }
      if (pending.size === 0) waiters.delete(sessionId);
    }
    return next;
  };

  const snapshotOf = (sessionId: string, afterRevision?: number): BrowserPanelSnapshot => {
    const frame = frames.get(sessionId);
    if (frame === undefined) {
      return { status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null };
    }
    frame.accessedAt = Date.now();
    const sendImage = frame.image !== undefined && afterRevision !== frame.revision;
    const imageBase64 = sendImage ? frame.image?.toString("base64") : undefined;
    return {
      status: frame.status,
      revision: frame.revision,
      activity: frame.activity,
      updatedAt: frame.updatedAt,
      url: frame.url,
      error: frame.error,
      ...(imageBase64 !== undefined && frame.mimeType !== undefined
        ? { mimeType: frame.mimeType, imageBase64 }
        : {}),
    };
  };

  const workspaceOf = (exec: BrowserToolExecution): string => {
    if (exec.agent?.session === undefined) {
      throw new Error("browser filesystem access requires a calling DSH Session");
    }
    return host.sandboxPolicy.resolve({ session: exec.agent.session }).workspaceRoot;
  };

  const safeOutputTarget = async (workspace: string, requested: string): Promise<string> => {
    const first = resolveTarget(workspace, requested);
    if (!first.insideWorkspace || first.unresolved === true) {
      throw new Error(`browser output path must stay inside the Session workspace: ${requested}`);
    }
    await mkdir(path.dirname(first.resolved), { recursive: true });
    const checked = resolveTarget(workspace, requested);
    if (!checked.insideWorkspace || checked.unresolved === true) {
      throw new Error(`browser output path escaped the Session workspace: ${requested}`);
    }
    try {
      const existing = await lstat(checked.resolved);
      if (existing.isSymbolicLink()) throw new Error(`browser output target is a symbolic link: ${requested}`);
      if (existing.isDirectory()) throw new Error(`browser output target is a directory: ${requested}`);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    return checked.resolved;
  };

  const safeInputSource = async (workspace: string, requested: string): Promise<string> => {
    const checked = resolveTarget(workspace, requested);
    if (!checked.insideWorkspace || checked.unresolved === true) {
      throw new Error(`browser input path must stay inside the Session workspace: ${requested}`);
    }
    const root = resolveTarget(workspace, ".").resolved;
    if (!isInside(root, checked.resolved)) {
      throw new Error(`browser input path escaped the Session workspace: ${requested}`);
    }
    const info = await stat(checked.resolved);
    if (!info.isFile()) throw new Error(`browser input path is not a regular file: ${requested}`);
    if (info.size > maxStagedInputBytes) {
      throw new Error(`browser input file exceeds the ${maxStagedInputBytes}-byte staging limit: ${requested}`);
    }
    return checked.resolved;
  };

  const stageName = (suffix: string): string => path.join(outputDir, `.dsh-browser-${randomUUID()}${suffix}`);
  const track = (file: string): string => {
    stagedFiles.add(file);
    return file;
  };
  const clean = async (file: string): Promise<void> => {
    stagedFiles.delete(file);
    await rm(file, { force: true }).catch(() => undefined);
  };

  const stageInput = async (workspace: string, requested: string): Promise<string> => {
    const source = await safeInputSource(workspace, requested);
    const staged = track(stageName(path.extname(source)));
    await mkdir(outputDir, { recursive: true });
    await copyFile(source, staged);
    return staged;
  };

  const capture = async (
    group: RegistrationGroup,
    exec: BrowserToolExecution,
    sessionId: string,
    workspace: string,
  ): Promise<void> => {
    if (!liveCapture || disposed || group.screenshot === undefined) return;
    const staged = track(stageName(".png"));
    try {
      await mkdir(outputDir, { recursive: true });
      await group.screenshot.execute({
        filename: staged,
        type: "png",
        scale: "css",
        _meta: { cwd: workspace },
      }, exec);
      const bytes = await readFile(staged);
      if (bytes.byteLength > maxFrameBytes) {
        throw new Error(`live frame exceeds the ${maxFrameBytes}-byte memory limit`);
      }
      touch(sessionId, { status: "ready", error: null, mimeType: "image/png", image: bytes });
    } catch (error: unknown) {
      // A panel refresh is observational. It must never turn a successful page
      // action into a failed model tool call.
      touch(sessionId, { status: "error", error: `live preview: ${messageOf(error)}` });
    } finally {
      await clean(staged);
    }
  };

  const prepare = async (
    tool: string,
    args: unknown,
    exec: BrowserToolExecution,
  ): Promise<{
    readonly args: Record<string, unknown>;
    readonly workspace: string;
    readonly output?: OutputStage;
    readonly stagedInputs: readonly string[];
  }> => {
    const original = recordOf(args);
    const workspace = workspaceOf(exec);
    const next: Record<string, unknown> = { ...original, _meta: { cwd: workspace } };
    const stagedInputs: string[] = [];
    const requested = typeof original.filename === "string" && original.filename !== ""
      ? original.filename
      : undefined;

    if (tool === NAVIGATE_TOOL && typeof original.url === "string"
      && (original.url.startsWith("file:") || path.isAbsolute(original.url))) {
      let localFile: string;
      try { localFile = original.url.startsWith("file:") ? fileURLToPath(original.url) : original.url; }
      catch { throw new Error("browser local preview requires a valid file:// URL"); }
      const source = await safeInputSource(workspace, localFile);
      next.url = await workspacePreview.urlForFile(workspace, source);
    }

    if (requested !== undefined && OUTPUT_FILENAME_TOOLS.has(tool)) {
      const target = await safeOutputTarget(workspace, requested);
      const staged = track(stageName(extensionFor(tool, requested)));
      next.filename = staged;
      return { args: next, workspace, output: { staged, target, display: requested }, stagedInputs };
    }
    if (requested !== undefined && INPUT_FILENAME_TOOLS.has(tool)) {
      const staged = await stageInput(workspace, requested);
      stagedInputs.push(staged);
      next.filename = staged;
    } else if (requested !== undefined && tool !== VIDEO_START_TOOL) {
      // A future Playwright MCP tool gained a filename with unknown semantics.
      // Refuse until it is classified as input or output instead of guessing.
      throw new Error(`browser workbench does not yet know whether ${tool}.filename is an input or output`);
    }
    if (INPUT_PATHS_TOOLS.has(tool) && Array.isArray(original.paths)) {
      const staged: string[] = [];
      for (const value of original.paths) {
        if (typeof value !== "string" || value === "") continue;
        const file = await stageInput(workspace, value);
        stagedInputs.push(file);
        staged.push(file);
      }
      next.paths = staged;
    }
    return { args: next, workspace, stagedInputs };
  };

  const tools = host.tools;
  const hadOwnRegister = Object.prototype.hasOwnProperty.call(tools, "register");
  const previousOwnRegister = hadOwnRegister
    ? Object.getOwnPropertyDescriptor(tools, "register")
    : undefined;
  const originalRegister = tools.register;

  tools.register = function registerBrowserAware(definition: BrowserToolDefinition): () => void {
    if (!definition.name.startsWith(BROWSER_PREFIX)) {
      return originalRegister.call(this, definition);
    }
    let owner = ((this as { readonly ctx?: object }).ctx ?? this) as object;
    // Cordis creates a fresh method-call shadow context on each service call.
    // Group by its caller context, never by the transient shadow or the shared
    // service target (which would mix separate agents' MCP connections).
    // This is the pinned Cordis symbols.shadow contract; keep plain hosts valid.
    while (Object.hasOwn(owner, Symbol.for("cordis.shadow"))) {
      const caller = Object.getPrototypeOf(owner) as object | null;
      if (caller === null) break;
      owner = caller;
    }
    let group = groups.get(owner);
    if (group === undefined) {
      group = {};
      groups.set(owner, group);
    }
    const originalExecute = definition.execute.bind(definition);
    const originalDefinition: BrowserToolDefinition = { ...definition, execute: originalExecute };
    if (definition.name === SCREENSHOT_TOOL) group.screenshot = originalDefinition;
    if (definition.name === UNSAFE_CODE_TOOL) group.unsafeCode = originalDefinition;

    const wrapped: BrowserToolDefinition = {
      ...definition,
      ...(definition.name === UNSAFE_CODE_TOOL ? {
        description: `${typeof definition.description === "string" ? definition.description : "Run Playwright code in the browser page context."}\nThis is browser/Playwright JavaScript, not a Node.js shell: require, child_process and host process execution are unavailable. Use the shell tool for commands and tests.`,
      } : definition.name === NAVIGATE_TOOL ? {
        description: `${typeof definition.description === "string" ? definition.description : "Navigate to a URL."}\nSession-local absolute paths and file:// URLs are safely previewed through an ephemeral 127.0.0.1 URL; unrestricted browser file access remains disabled.`,
      } : {}),
      async execute(args: unknown, exec: BrowserToolExecution): Promise<unknown> {
        const sessionId = sessionIdOf(exec);
        let callActivity = 0;
        if (sessionId !== undefined) {
          callActivity = (frames.get(sessionId)?.activity ?? 0) + 1;
          // Closing should only make the side panel disappear. Publishing an
          // intermediate `working` state would wake the long poll, briefly
          // reopen the panel, and then close it again on the idle result.
          if (definition.name !== CLOSE_TOOL) {
            touch(sessionId, { status: "working", error: null, activity: callActivity });
          }
        }
        let stagedInputs: readonly string[] = [];
        let output: OutputStage | undefined;
        let workspace: string | undefined;
        try {
          const requestPolicy = sessionId === undefined ? undefined : requestPolicies.get(sessionId);
          if (requestPolicy !== undefined && definition.name === UNSAFE_CODE_TOOL) {
            throw new Error("browser unsafe code is disabled while a host request policy is active");
          }
          if (requestPolicy !== undefined && [
            `${BROWSER_PREFIX}browser_route`,
            `${BROWSER_PREFIX}browser_unroute`,
            `${BROWSER_PREFIX}browser_network_state_set`,
          ].includes(definition.name)) {
            throw new Error(`${definition.name} is disabled while a host request policy is active`);
          }
          if (requestPolicy !== undefined && definition.name !== CLOSE_TOOL) {
            if (group?.unsafeCode === undefined) {
              throw new Error("browser request policy cannot be enforced because Playwright unsafe-code support is unavailable");
            }
            const marker = `DSH_BROWSER_WORKBENCH_REQUEST_POLICY_${randomUUID()}`;
            const installed = await group.unsafeCode.execute({
              code: policyInstallerCode(requestPolicy.allowedOrigins, marker),
              _meta: { cwd: workspaceOf(exec) },
            }, exec);
            if (!containsText(installed, marker)) {
              throw new Error("browser request policy installer did not return its host proof marker");
            }
          }
          const ready = await prepare(definition.name, args, exec);
          stagedInputs = ready.stagedInputs;
          output = ready.output;
          workspace = ready.workspace;

          // Video output becomes complete only when browser_stop_video runs.
          if (definition.name === VIDEO_START_TOOL) {
            const requested = typeof recordOf(args).filename === "string" ? recordOf(args).filename as string : undefined;
            if (requested !== undefined && requested !== "") {
              if (sessionId === undefined) throw new Error("browser video output requires a calling Session");
              if (pendingVideos.has(sessionId)) {
                throw new Error("a browser video output is already pending for this Session; stop it before starting another");
              }
              const target = await safeOutputTarget(workspace, requested);
              const staged = track(stageName(extensionFor(definition.name, requested).replace(/\.png$/i, ".webm")));
              ready.args.filename = staged;
              pendingVideos.set(sessionId, { staged, target, display: requested });
            }
          }

          let value = await originalExecute(ready.args, exec);
          if (output !== undefined) {
            await copyFile(output.staged, output.target);
            value = replaceFileResult(value, output);
          }
          if (definition.name === VIDEO_STOP_TOOL && sessionId !== undefined) {
            const video = pendingVideos.get(sessionId);
            if (video !== undefined) {
              await copyFile(video.staged, video.target);
              value = replaceFileResult(value, video);
              pendingVideos.delete(sessionId);
              await clean(video.staged);
            }
          }

          if (sessionId !== undefined) {
            const pageUrl = pageUrlOf(value);
            const url = pageUrl === undefined
              ? undefined
              : workspacePreview.displayAddress(pageUrl) ?? pageUrl;
            const directImage = definition.name === SCREENSHOT_TOOL ? imageOf(value) : undefined;
            if (directImage !== undefined && directImage.bytes.byteLength <= maxFrameBytes) {
              touch(sessionId, {
                status: "ready",
                error: null,
                ...(url === undefined ? {} : { url }),
                mimeType: directImage.mimeType,
                image: directImage.bytes,
              });
            } else if (definition.name === CLOSE_TOOL) {
              touch(sessionId, {
                status: "idle",
                error: null,
                activity: callActivity,
                image: undefined,
                mimeType: undefined,
              });
            } else {
              touch(sessionId, { status: "ready", error: null, ...(url === undefined ? {} : { url }) });
              if (CAPTURE_AFTER.has(definition.name) && workspace !== undefined) {
                await capture(group as RegistrationGroup, exec, sessionId, workspace);
              }
            }
          }
          return value;
        } catch (error: unknown) {
          if (definition.name === VIDEO_START_TOOL && sessionId !== undefined) {
            const video = pendingVideos.get(sessionId);
            if (video !== undefined) {
              pendingVideos.delete(sessionId);
              await clean(video.staged);
            }
          }
          if (sessionId !== undefined) {
            touch(sessionId, {
              status: "error",
              error: messageOf(error),
              activity: callActivity,
            });
          }
          throw error;
        } finally {
          if (output !== undefined) await clean(output.staged);
          for (const file of stagedInputs) await clean(file);
        }
      },
    };
    const disposeRegistration = originalRegister.call(this, wrapped);
    return () => {
      if (definition.name === SCREENSHOT_TOOL && group?.screenshot === originalDefinition) {
        delete group.screenshot;
      }
      if (definition.name === UNSAFE_CODE_TOOL && group?.unsafeCode === originalDefinition) {
        delete group.unsafeCode;
      }
      disposeRegistration();
    };
  };

  note(`browser workbench armed (session files + ${liveCapture ? "live preview" : "no preview"})`);

  return {
    snapshot(sessionId: string, afterRevision?: number): BrowserPanelSnapshot {
      return snapshotOf(sessionId, afterRevision);
    },
    async waitSnapshot(sessionId: string, afterRevision: number, timeoutMs: number): Promise<BrowserPanelSnapshot> {
      const current = snapshotOf(sessionId, afterRevision);
      if (current.revision !== afterRevision || timeoutMs <= 0 || disposed) return current;
      const bounded = Math.min(30_000, Math.max(250, timeoutMs));
      return await new Promise<BrowserPanelSnapshot>((resolve) => {
        const bucket = waiters.get(sessionId) ?? new Set<SnapshotWaiter>();
        waiters.set(sessionId, bucket);
        let waiter: SnapshotWaiter;
        const timer = setTimeout(() => {
          bucket.delete(waiter);
          if (bucket.size === 0) waiters.delete(sessionId);
          resolve(snapshotOf(sessionId, afterRevision));
        }, bounded);
        waiter = { afterRevision, resolve, timer };
        bucket.add(waiter);
      });
    },
    setRequestPolicy(sessionId: string, policy: BrowserRequestPolicy | null): void {
      if (policy === null) requestPolicies.delete(sessionId);
      else {
        if (config.serviceWorkersBlocked !== true) {
          throw new Error("browser request policy requires Playwright MCP --block-service-workers");
        }
        requestPolicies.set(sessionId, normalizeRequestPolicy(policy));
      }
    },
    dispose(): void {
      disposed = true;
      frames.clear();
      pendingVideos.clear();
      requestPolicies.clear();
      for (const [sessionId, pending] of waiters) {
        for (const waiter of pending) {
          clearTimeout(waiter.timer);
          waiter.resolve({ status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null });
        }
        waiters.delete(sessionId);
      }
      if (previousOwnRegister !== undefined) Object.defineProperty(tools, "register", previousOwnRegister);
      else if (!hadOwnRegister) delete (tools as { register?: unknown }).register;
      for (const file of stagedFiles) void rm(file, { force: true }).catch(() => undefined);
      stagedFiles.clear();
      workspacePreview.dispose();
    },
  };
}
