# Strique DSH MCP Client

This repository maintains the `dsh-mcp-manager-secure` Harness plugin. The repository name and npm package name deliberately differ: preserve the package identity, bundle row, client loader ID and state namespace when changing repository metadata.

## Implementation

Keep the runtime in `lib/index.js` (Host, plain Node ESM) and `lib/client.js` (browser, hand-written React module factory). `lib/index.d.ts` declares the public configuration. The browser contributes Settings > MCP (Secure) through the Harness slot and uses only the authenticated same-origin management API. Preserve the upstream MIT license and attribution.

Before changing authentication, credentials, subprocesses, workspace configuration, or tool permissions, read [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md). The Host owns validation and authorization; browser controls are presentation. MCP metadata never grants authority. Preserve exact-definition workspace approval, configuration-bound credentials, Ask-by-default tool permissions, registry guards, cancellation and lifecycle cleanup.

Use the pinned MCP SDK for protocol and OAuth behavior. Use the existing Harness approval service for per-call questions and its session audit. Every MCP dispatch, including the discovery broker, must traverse the real Harness tool registry. Effects own routes, hooks, tool registrations, children and watchers, and withdraw them on disposal.

Global private state is resolved from the active Harness home and profile. Workspace proposals use `.dsh/dshmm/mcp.json`. Keep credentials in private Host storage, redact management responses, and use only synthetic secrets in tests. Local credentials, browser storage, launch logs and generated artifacts stay outside Git.

## Verification and publication

Use the scripts in `package.json` for syntax and regression tests. For runtime, permissions, protocol, UI, packaging or lifecycle changes, use the corresponding real Harness, browser and installed-profile checks in [docs/verification.md](docs/verification.md). Tests own isolated homes and synthetic MCP servers. The Firecrawl provider test is opt-in and uses a private credential. Check listener and HTTP responses before reporting a local deployment as running.

Sync the English and Chinese READMEs on behavior changes and update the changelog with the package version. Package using the manifest file allowlist and inspect the archive for credentials. User-authorized source releases use an annotated version tag on the tested main commit. npm publishing and changes to a running user profile require authorization for those specific actions. Keep a verified artifact and profile backup for rollback. Preserve existing servers during repository-only work.
