/**
 * Same-origin JSON route for the transient native Browser side panel.
 *
 * The request carries only a Session id, the last revision already shown and
 * an optional bounded long-poll duration.
 * It never carries a path, workspace root, browser endpoint or MCP arguments;
 * those capabilities stay on the Host side in browser/workbench.ts.
 */
export const BROWSER_PANEL_ROUTE = "/dsh-browser-workbench/live";
const MAX_BODY_BYTES = 4096;
/** Register one bounded long-poll endpoint for the browser side panel. */
export function serveBrowserPanel(host, browser, note) {
    try {
        return host.webServer.register({
            kind: "exact",
            path: BROWSER_PANEL_ROUTE,
            handler: async (req, res) => {
                const reply = (status, body) => {
                    res.writeHead(status, {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": "no-store",
                    });
                    res.end(JSON.stringify(body));
                };
                if (req.method !== "POST")
                    return reply(405, { ok: false, error: "POST only" });
                const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim();
                if (mediaType !== "application/json") {
                    return reply(415, { ok: false, error: "content type must be application/json" });
                }
                let raw = "";
                for await (const chunk of req) {
                    raw += String(chunk);
                    if (raw.length > MAX_BODY_BYTES)
                        return reply(413, { ok: false, error: "request too long" });
                }
                let body = {};
                try {
                    body = JSON.parse(raw);
                }
                catch {
                    return reply(400, { ok: false, error: "invalid JSON" });
                }
                if (typeof body.sessionId !== "string" || body.sessionId === "" || body.sessionId.length > 256) {
                    return reply(400, { ok: false, error: "expected { sessionId }" });
                }
                const afterRevision = typeof body.afterRevision === "number"
                    && Number.isSafeInteger(body.afterRevision)
                    && body.afterRevision >= 0
                    ? body.afterRevision
                    : undefined;
                const waitMs = typeof body.waitMs === "number"
                    && Number.isSafeInteger(body.waitMs)
                    && body.waitMs >= 0
                    && body.waitMs <= 30_000
                    ? body.waitMs
                    : 0;
                const result = waitMs > 0 && afterRevision !== undefined
                    ? await browser.waitSnapshot(body.sessionId, afterRevision, waitMs)
                    : browser.snapshot(body.sessionId, afterRevision);
                return reply(200, {
                    ok: true,
                    result,
                });
            },
        });
    }
    catch (error) {
        note(`could not claim ${BROWSER_PANEL_ROUTE} — ${error instanceof Error ? error.message : String(error)}`);
        return () => undefined;
    }
}
//# sourceMappingURL=browser-panel.js.map