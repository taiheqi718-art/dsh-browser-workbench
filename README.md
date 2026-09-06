# DSH Browser Workbench

Codex-style browser tooling for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the model receives the official Playwright MCP tools, and the page it operates appears only when used, inside DSH's existing right-side details track.

This package is an adapter, not a browser engine and not a second MCP client. It deliberately reuses:

- DeepSeek Harness `@deepseek-ai/dsh-mcp-client` for discovery, stdio transport, reconnect and result projection;
- Microsoft `@playwright/mcp` for browser automation;
- DSH `sandboxPolicy` for the authoritative Session workspace;
- DSH `shell.overlay` and the official details track for UI presentation.

The package adds only the missing integration layer: Session-aware file fencing, safe local-workspace preview, model-invisible live frames, and the transient side panel.

## Status

`0.1.0-alpha.1` targets DSH `0.1.2-alpha.1`. It is tested on Windows. DSH Alpha2 and macOS launch, reload and multi-Session validation remain release gates; a later compatibility release will not silently mix Alpha1 and Alpha2 packages.

## Features

- Browser tools start lazily through the official DSH MCP bridge.
- Each call is bound to the calling Session workspace.
- Screenshot, PDF, console, network and storage-state outputs are staged and copied through a symlink-aware workspace fence.
- Uploads and storage-state inputs must come from the current Session workspace and are size-bounded.
- A local HTML file is previewed through a random, loopback-only URL; unrestricted browser file access stays disabled.
- Successful page actions refresh a bounded in-memory frame for the UI. This automatic frame is not sent to the model and adds no image tokens.
- No permanent browser tab: first browser activity opens DSH's existing details column; closing it keeps it closed until the next model browser action.
- Optional exact-origin request policy for a Host that needs per-Session network leases.

## Architecture

```text
Agent preset
  └─ official @deepseek-ai/dsh-mcp-client
       └─ pinned Microsoft @playwright/mcp
            └─ installed Chrome / Edge / Chromium

DSH Browser Workbench Host
  ├─ wraps mcp__browser__* registration
  ├─ binds files to sandboxPolicy(Session).workspaceRoot
  ├─ keeps latest model-invisible frame per Session
  └─ serves a bounded same-origin long-poll route

DSH Browser Workbench Client
  └─ overlays only DSH's official right details track
```

There is no dependency on Exp Harness, AI Company, Smart Auto, benchmark code or a private directory layout.

## Install for local development

Use PowerShell 7 on Windows:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-direct.ps1
npm run check
```

The installer clears proxy variables only for its own process tree, uses the npm registry directly, skips lifecycle scripts and disables Playwright browser downloads. It does not change the system proxy or global npm settings.

## Add to DSH

1. Install the package as a profile plugin:

   ```powershell
   dsh plugin --profile web add .
   ```

2. Give it one absolute runtime root. Example:

   ```powershell
   $env:DSH_BROWSER_WORKBENCH_RUNTIME = 'E:\dsh-runtime\browser-workbench'
   ```

   `DSH_BROWSER_EXECUTABLE` is optional; the plugin detects Chrome, Edge or Chromium in standard Windows, macOS and Linux locations.

   If the dedicated variable is omitted, the plugin uses `DSH_HOME/browser-workbench`. It fails loudly when neither location exists instead of loading a Client that repeatedly polls a missing Host route.

3. Add the row in [`agent.cordis.yml`](./agent.cordis.yml) to each Agent preset that should receive browser tools.

The package intentionally does not rewrite existing Agent presets. Presets are user-owned compositions; silently replacing one could remove its tools, permissions or model policy. The included row consumes the Host-resolved `dshBrowserWorkbench` service, so it contains no machine path and invokes no `npx`.

Built Host artifacts are committed with the source. This lets DSH install the plugin directly from Git without executing an unreviewed `prepare` hook; CI rebuilds them and rejects stale output.

4. Build and check the active environment:

   ```powershell
   npm run build
   npm run doctor
   ```

## Security boundaries

- The Client submits only `sessionId`, `afterRevision` and a bounded wait duration. It cannot choose a workspace path, browser endpoint or MCP argument.
- The Host derives the workspace from DSH's Session and sandbox policy.
- Inputs and outputs are checked through real paths and deepest-existing ancestors, blocking junction/symlink escapes.
- Unknown future Playwright tools with an unclassified `filename` fail closed.
- Playwright runs with `--isolated`, `--block-service-workers`, `--headless` and without `--allow-unrestricted-file-access`.
- Runtime state, browser profile, cache, temp files and output staging stay below the configured runtime root.

This protects the DSH-to-browser file boundary. It is not an operating-system sandbox for hostile browser binaries or malicious websites.

## Cost and performance

The adapter makes no model calls. It adds one local screenshot after page-changing browser actions when live capture is enabled. The screenshot is kept in bounded memory and is not included in model context. Model-requested screenshots and the browser tool schemas still have their ordinary context cost.

## Current limitations

- The panel shows the latest frame, not a video stream.
- Human mouse/keyboard takeover inside the frame is not implemented.
- An Agent preset must opt in to the official MCP row.
- The first stable release still requires macOS and newer-DSH compatibility verification.

## Development

```powershell
npm run build
npm test
npm pack --dry-run
```

Tests cover Session fencing, staged I/O cleanup, local preview, hidden live capture, request policies, controller disposal, runtime resolution, bundle isolation and transient Client registration.

## License

MIT. Microsoft Playwright MCP remains separately licensed under Apache-2.0.
