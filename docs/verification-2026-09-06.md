# Verification record — 2026-09-06

Release candidate: `0.1.0-alpha.1`

## Passed

- TypeScript build and committed-output freshness check.
- 5 test files, 18 tests: Session input/output fences, junction-aware resolution, local preview, live-frame bounds, request-policy enforcement, cleanup, disposal, runtime descriptor, package isolation and Client overlay registration.
- `npm pack --dry-run`: intended publish files only, with no private Harness or benchmark paths.
- Doctor: pinned `@playwright/mcp@0.0.79`, installed Microsoft Edge and an absolute project-local runtime root.
- Real browser chain: MCP SDK → pinned Playwright MCP → system Edge → Session fence → model-invisible live frame.
- Official Host composition: DSH `0.1.2-alpha.1` `ToolRuntime` + official `dsh-mcp-client` + this plugin + pinned Playwright MCP + system Edge. Browser tools registered, hidden frame updated, and an explicit screenshot was copied into the calling Session workspace.

No model or paid API was invoked. Runtime fixtures and npm cache remained below the E-drive project and were cleaned or ignored.

## Not yet claimed

- A fresh install into a separate full DSH Web profile and an interactive click-through of the independently packaged right-side panel.
- macOS Chrome/Edge launch, reload and multi-Session isolation.
- DSH `0.1.2-alpha.2` compatibility.

Those are release gates, not implied by the Host/browser pass above.
