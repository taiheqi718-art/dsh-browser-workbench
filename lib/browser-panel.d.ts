/**
 * Same-origin JSON route for the transient native Browser side panel.
 *
 * The request carries only a Session id, the last revision already shown and
 * an optional bounded long-poll duration.
 * It never carries a path, workspace root, browser endpoint or MCP arguments;
 * those capabilities stay on the Host side in browser/workbench.ts.
 */
import type { BrowserWorkbenchController } from "./browser-workbench.js";
export declare const BROWSER_PANEL_ROUTE = "/dsh-browser-workbench/live";
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
export declare function serveBrowserPanel(host: BrowserPanelHost, browser: BrowserWorkbenchController, note: (message: string) => void): () => void;
export {};
