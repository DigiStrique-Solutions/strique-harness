# Changes

## Unreleased

- Target Harness `0.2.0-rc.2` and refresh the dependency lockfile.
- Preserve existing plugin behavior; compatibility checks pass without exemptions.

## 0.9.2

- Verify the existing authenticated management, tool permission, approval, workspace scope and lifecycle integration against DeepSeek Harness 0.1.7-rc.2.
- Update the local package and compatibility documentation for the tested Harness release. No Host or Client behavior changes were required.

## 0.9.1

- Preserve Allow, Ask and Block across tool description/title changes with a separate operational permission fingerprint. Keep schema constraints, literal values, server configuration and execution annotations in the permission check.
- Migrate legacy permissions only on an exact saved-definition match; never restore an existing Ask automatically.
- Show persistent review notices for changed tools and explain Ask failures when session approval prompts are disabled. Preserve approval audit, stale-write checks and dispatch guards.
- Add permission migration, nested-schema, real Harness Full access and browser review regressions.


## 0.9.0 (registered OAuth clients and HTTPS callbacks)

- Support pre-registered public OAuth client IDs through Host configuration, keeping SDK-managed PKCE and bypassing dynamic registration.
- Discard OAuth credentials and reset tool permissions when the configured client changes.
- Support an explicit HTTPS origin for reverse proxies while preserving Harness Host, authentication and OAuth state checks. Ignore forwarded headers for callback construction.

## 0.8.0 (tool permissions)

- Add searchable per-tool Always allow, Ask each time and Block controls, with bulk updates for displayed tools.
- Default to Ask and bind saved choices to the server configuration and complete tool definition. Preserve choices across reconnect and reset changed tools for review.
- Enforce choices in the real Harness policy pipeline, monotonic guards and immediately before transport dispatch, including the discovery broker.
- Reuse Harness one-time approvals and session audit events. Fail closed on missing approval, cancellation, timeout, shutdown or changed permissions while waiting.
- Validate authenticated permission updates atomically and reject stale definitions. Delete saved permission records when removing a global server.

## 0.7.0 (local security fork)

Forked upstream 0.6.0 at `69d5cbc` into the separate `dsh-mcp-manager-secure` package.

1. Require authenticated Harness management requests and trusted request origins.
2. Replace full subprocess environment inheritance with a minimal allowlist plus explicit configuration.
3. Redact header and environment secrets from management views and preserve unchanged secrets during edits.
4. Validate OAuth state before handling errors; escape callback HTML and apply CSP.
5. Require persisted approval of exact workspace definitions before connecting or launching.
6. Bind credentials to the complete endpoint and approved workspace configuration.
7. Preserve disabled status during edits.
8. Cancel stale connection generations to prevent late registration after disable/delete.
9. Connect no-auth and custom-header-only HTTP servers.
10. Preserve structured results/content/error flags; use exclusive tool scheduling.
11. Propagate execution cancellation through MCP and abort the corresponding HTTP request.
12. Withdraw stale tools when a process exits and use bounded reconnects.
13. Respect the active Harness home and profile, with private atomic state files and a single-writer lock.

Additional hardening includes bounded JSON/stdio/HTTP messages and discovery, lifecycle cleanup of owned child processes, safe workspace writes, SDK OAuth discovery/PKCE, SameSite=Strict callback navigation, preserving running agents' workspace restrictions across reload, and authenticated English settings UI with explicit approval, secret fields, loading/error states and reconnect controls.

OAuth endpoints wait for an explicit Authenticate action before attempting client registration. Provider registration and authorization failures use specific fixed messages without exposing response bodies, and failed initial authentication does not trigger connection-loss retry loops. Meta Ads' rejection of this client's dynamic registration is documented as a provider compatibility limitation.

No automatic import from the old state file, public release or installation into an existing user profile is performed by this fork's tests.
