# Changelog

## 0.1.0-alpha.1

- Added a persistent per-session Codex-style side-panel icon so the official DSH details sidebar can be folded and reopened without waiting for another agent action. A real agent `browser_close` still clears the frame and entry.
- Added a responsive wide details-track bridge so the conversation reflows instead of being covered, plus conversation-workspace fullscreen/`Esc` controls that preserve the left project sidebar.
- Added a browser-style address field that shows real web URLs and safe `workspace/...` paths instead of private loopback preview URLs.
- Extracted the Session-aware browser adapter from the private workbench.
- Kept DSH's official MCP client and Microsoft's Playwright MCP as the transport and browser owners.
- Added symlink-aware Session input/output fencing and tokenized local preview.
- Added a model-invisible live-frame cache and transient official-details overlay.
- Added a Host-resolved MCP descriptor so Agent presets contain no machine paths or `npx` calls.
- Added exact-origin request-policy support, unit tests and a real system-browser smoke test.
- Pinned the Host compatibility declaration to DSH Alpha1 and made it host-supplied, preventing package managers from auto-installing a mixed Alpha2 MCP stack.
