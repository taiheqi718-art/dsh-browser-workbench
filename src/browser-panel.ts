/**
 * Same-origin JSON route for the transient native Browser side panel.
 *
 * The request carries only a Session id, the last revision already shown and
 * an optional bounded long-poll duration.
 * It never carries a path, workspace root, browser endpoint or MCP arguments;
 * those capabilities stay on the Host side in browser/workbench.ts.
 */

import type { BrowserWorkbenchController } from "./browser-workbench.js";

export const BROWSER_PANEL_ROUTE = "/dsh-browser-workbench/live";
const MAX_BODY_BYTES = 4096;

interface BrowserPanelRequest {
  readonly method?: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
}

interface BrowserPanelResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: string): unknown;
}

export interface BrowserPanelHost {
  webServer: {
    register(route: {
      kind: "exact";
      path: string;
      handler: (req: BrowserPanelRequest, res: BrowserPanelResponse) => void | Promise<void>;
    }): () => void;
  };
}

/** Register one bounded long-poll endpoint for the browser side panel. */
export function serveBrowserPanel(
  host: BrowserPanelHost,
  browser: BrowserWorkbenchController,
  note: (message: string) => void,
): () => void {
  try {
    return host.webServer.register({
      kind: "exact",
      path: BROWSER_PANEL_ROUTE,
      handler: async (req, res) => {
        const reply = (status: number, body: unknown): void => {
          res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
        const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim();
        if (mediaType !== "application/json") {
          return reply(415, { ok: false, error: "content type must be application/json" });
        }
        let raw = "";
        for await (const chunk of req) {
          raw += String(chunk);
          if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "request too long" });
        }
        let body: { sessionId?: unknown; afterRevision?: unknown; waitMs?: unknown } = {};
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
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
  } catch (error: unknown) {
    note(`could not claim ${BROWSER_PANEL_ROUTE} — ${error instanceof Error ? error.message : String(error)}`);
    return () => undefined;
  }
}
