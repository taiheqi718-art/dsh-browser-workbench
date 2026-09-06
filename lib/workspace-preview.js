/**
 * Ephemeral, capability-addressed HTTP preview for files in one DSH Session
 * workspace. Playwright deliberately blocks file:// navigation; this bridge
 * keeps the safer default and exposes only a random-token route on loopback.
 *
 * @module browser/workspace-preview
 */
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { resolveTarget } from "./path-security.js";
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
};
/** Create the bridge lazily: no socket exists until a local file is opened. */
export function createWorkspacePreviewBridge(maxFileBytes = DEFAULT_MAX_FILE_BYTES) {
    const roots = new Map();
    const tokens = new Map();
    let server;
    let port;
    let starting;
    let disposed = false;
    const start = async () => {
        if (port !== undefined)
            return;
        if (disposed)
            throw new Error("browser workspace preview is disposed");
        starting ??= new Promise((resolve, reject) => {
            const next = createServer(async (request, response) => {
                response.setHeader("Cache-Control", "no-store");
                response.setHeader("X-Content-Type-Options", "nosniff");
                response.setHeader("Referrer-Policy", "no-referrer");
                if (request.method !== "GET" && request.method !== "HEAD") {
                    response.writeHead(405, { Allow: "GET, HEAD" }).end();
                    return;
                }
                try {
                    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
                    const encoded = parsed.pathname.split("/").filter(Boolean);
                    const token = encoded.shift();
                    const workspace = token === undefined ? undefined : roots.get(token);
                    if (workspace === undefined || encoded.length === 0) {
                        response.writeHead(404).end();
                        return;
                    }
                    const segments = encoded.map((part) => decodeURIComponent(part));
                    if (segments.some((part) => part === "" || part === "." || part === ".." || part.includes("\\") || part.includes("/"))) {
                        response.writeHead(403).end();
                        return;
                    }
                    const checked = resolveTarget(workspace, path.join(...segments));
                    if (!checked.insideWorkspace || checked.unresolved === true) {
                        response.writeHead(403).end();
                        return;
                    }
                    const info = await stat(checked.resolved);
                    if (!info.isFile() || info.size > maxFileBytes) {
                        response.writeHead(info.isFile() ? 413 : 404).end();
                        return;
                    }
                    const body = request.method === "HEAD" ? undefined : await readFile(checked.resolved);
                    response.writeHead(200, {
                        "Content-Length": info.size,
                        "Content-Type": MIME_TYPES[path.extname(checked.resolved).toLowerCase()] ?? "application/octet-stream",
                    });
                    response.end(body);
                }
                catch {
                    // Do not reveal host paths or filesystem error details to a page.
                    response.writeHead(404).end();
                }
            });
            next.once("error", reject);
            next.listen(0, "127.0.0.1", () => {
                const address = next.address();
                if (typeof address !== "object" || address === null) {
                    next.close();
                    reject(new Error("browser workspace preview did not acquire a loopback port"));
                    return;
                }
                server = next;
                port = address.port;
                next.unref();
                resolve();
            });
        });
        await starting;
    };
    return {
        async urlForFile(workspace, absoluteFile) {
            const root = resolveTarget(workspace, ".").resolved;
            const checked = resolveTarget(root, absoluteFile);
            if (!checked.insideWorkspace || checked.unresolved === true) {
                throw new Error("browser preview file must stay inside the Session workspace");
            }
            const info = await stat(checked.resolved);
            if (!info.isFile())
                throw new Error("browser preview target is not a regular file");
            if (info.size > maxFileBytes)
                throw new Error(`browser preview file exceeds the ${maxFileBytes}-byte limit`);
            await start();
            let token = tokens.get(root);
            if (token === undefined) {
                token = randomUUID().replaceAll("-", "");
                tokens.set(root, token);
                roots.set(token, root);
            }
            const relative = path.relative(root, checked.resolved);
            const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
            return `http://127.0.0.1:${port}/${token}/${encoded}`;
        },
        dispose() {
            disposed = true;
            roots.clear();
            tokens.clear();
            server?.close();
            server = undefined;
            port = undefined;
        },
    };
}
//# sourceMappingURL=workspace-preview.js.map