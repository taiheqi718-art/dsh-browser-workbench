# Contributing

Thanks for helping make browser work inside DeepSeek Harness feel native.

The most useful contributions during the alpha phase are focused compatibility reports, especially for macOS, Linux and newer DSH releases.

## Before opening an issue

Please include:

- operating system and version;
- DSH version;
- Node.js version;
- browser name and version;
- whether the failure is in tool registration, browser launch, Session-local preview, file transfer or the right-side panel;
- the output of `npm run doctor`, with local paths and credentials redacted.

Never attach credentials, browser profiles, private project files or an entire DSH data directory.

## Development checks

Use Node.js `22.19+`. On Windows, use PowerShell 7.

~~~powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-direct.ps1
npm run check
~~~

Before submitting a pull request, confirm that generated files under `lib/` match the TypeScript source and that `npm pack --dry-run` contains only the intended public package files. `npm run check` enforces both.

## Scope

This project deliberately remains an adapter around the official DSH MCP client and Microsoft Playwright MCP. Proposals that replace either layer should first explain why the missing behavior cannot be added without forking the stack.

Security boundary changes need tests for path escapes, cross-Session leakage and failure behavior. Please report exploitable issues privately through GitHub Security Advisories instead of a public issue.
