# Verification record — 2026-09-06

Release candidate: `0.1.0-alpha.1`

## Passed

- TypeScript build and committed-output freshness check.
- 5 test files, 18 tests: Session input/output fences, junction-aware resolution, local preview, live-frame bounds, request-policy enforcement, cleanup, disposal, runtime descriptor, package isolation and Client overlay registration.
- `npm pack --dry-run`: intended publish files only, with no private Harness or benchmark paths.
- Doctor: pinned `@playwright/mcp@0.0.79`, installed Microsoft Edge and an absolute project-local runtime root.
- Real browser chain: MCP SDK → pinned Playwright MCP → system Edge → Session fence → model-invisible live frame.
- Official Host composition: DSH `0.1.2-alpha.1` `ToolRuntime` + official `dsh-mcp-client` + this plugin + pinned Playwright MCP + system Edge. Browser tools registered, hidden frame updated, and an explicit screenshot was copied into the calling Session workspace.
- Fresh packaged install into an isolated full DSH Web `0.1.2-alpha.1` profile. A deterministic local mock model invoked the installed browser tool, system Edge opened the Session-local HTML through the loopback preview, the native right-side overlay opened only after browser activity, displayed the captured frame, and yielded cleanly to DSH's official tool details.
- Reopen lifecycle retest in the same isolated full profile: the first browser action opened the right details track, the panel close button folded it without losing the captured frame, the new per-session side-panel icon remained visible, and clicking it restored the same live view. Production port `3080` was not used.
- The full-profile pass caught and fixed a Client-only scope error that Host and registration tests could not expose: the overlay referenced `ctx.layout` outside `apply(ctx)`. The Client now captures the injected layout service during activation, and the package declares its direct renderer dependency.

No cloud model or paid API was invoked. The interactive test used only DSH's local deterministic mock server. Runtime fixtures, package-manager stores and caches remained below the E-drive project and were cleaned or ignored.

## Not yet claimed

- macOS Chrome/Edge launch, reload and multi-Session isolation.
- DSH `0.1.2-alpha.2` compatibility.

Those are release gates, not implied by the Host/browser pass above.
