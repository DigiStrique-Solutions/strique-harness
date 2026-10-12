# Security model

This fork addresses the 13 findings in the September 9, 2026 audit. Passing regression tests is evidence about those scenarios, not a guarantee that the package has no vulnerabilities.

## Boundaries

- Management uses Harness browser authentication and Host/Origin checks. Cross-origin writes and non-JSON mutations are rejected. OAuth landing pages do not exchange codes without authentication. Callback state is random, expiring, single-use and bound to the configured endpoint and redirect origin. Rendered HTML escapes untrusted values and forbids scripts.
- Local workspace files are untrusted proposals. Persisted approval binds the normalized configuration, and dispatch checks that the file still matches. Changed endpoints cannot acquire previously issued OAuth tokens. The settings UI is an administrator surface and intentionally has authority to approve and launch processes.
- Local commands are trusted executable code running as the Harness account, not sandboxed code. A minimal inherited environment prevents accidental wholesale secret inheritance but does not prevent access to the account's files, keychains, network, or other processes. Explicit environment entries can change subprocess behavior. Install only trusted packages and pin their versions.
- MCP responses and descriptions are untrusted input for the model. Byte/time/tool limits reduce resource exhaustion, and rich content is not interpreted as browser HTML. These controls cannot eliminate model prompt injection or guarantee correctness of a remote tool. Harness execution policy remains necessary for consequential calls.
- HTTP uses HTTPS except loopback HTTP and refuses redirects. Explicit headers are attached only to the configured resource URL, not OAuth discovery endpoints. OAuth metadata can identify different HTTPS authorization endpoints. This is not a private-network firewall; trusted administrators can connect private services. Use network isolation when MCP servers are untrusted.
- Profile state is private to the OS account, not encrypted against that account or its administrators. `DSH_HOME` and an optional `stateDir` must be trusted. Single-writer locks and atomic replacement protect routine concurrent startup and interrupted writes. An adversary with write access to the account's parent directories or code execution as the same user is outside this boundary.

## Operating limits

The browser OAuth flow is verified against the local Harness HTTP deployment. HTTPS reverse proxies require an explicit `publicOrigin` and Harness trusted hostname; forwarded headers cannot select the origin. Provider-specific OAuth policies need separate testing. Windows process-tree cleanup is implemented but is not claimed verified without a Windows run. Finite connection retries can be exhausted; use Reconnect after correcting the endpoint. Local stdio cancellation requires server cooperation for the individual operation; disabling the server terminates its owned process group on POSIX.

Credentials belong in environment references or secret header/environment fields, never URL query strings or command arguments, which are visible configuration. Workspace files containing literal secrets remain readable by anyone who can already read that workspace. The UI masks those values, and writes made through the manager use private file permissions.

Built-in media rendering retains non-text blocks as structured data and displays notices instead of fetching external images/resources. Pre-registered public OAuth client IDs are supported through Host configuration and bound to their credentials and tool permissions. Confidential OAuth clients requiring client secrets and legacy SSE-only MCP transports are not implemented by this manager.

The pinned Harness settings shell clips plugin content on phone-size viewports. Desktop interaction tests pass; phone usability is a known upstream limitation.

## Reporting

Record a minimal reproduction with synthetic credentials, package/SDK/Harness versions, and the affected code path. Do not include real tokens, user state files, browser cookies, or private command output in an issue or shared test artifact.

## Per-tool authorization

The Host stores Allow, Ask or Block for each server/tool pair, bound to a versioned SHA-256 digest of its configuration and operational definition. Tool, annotation and schema titles and descriptions are excluded from that permission digest; property names, literal values, validation constraints, execution annotations and unknown extension fields remain significant. Documentation changes can still influence model behavior, but do not expand the saved tool permission. New tools and changes to the operational definition default to Ask. A separate complete-definition fingerprint still rejects stale management writes and stale registered definitions. Legacy permissions migrate only on an exact complete-definition match; already-reset or deliberately selected Ask remains Ask. Server annotations never authorize a call. The authenticated settings API cannot accept a stale fingerprint and applies bulk changes atomically.

Ask calls the existing Harness approval service with the real agent and correlated root call identifier. Harness owns approval routing, one-use answers, session audit, missing-answerer behavior and cancellation. A per-execution Symbol grant is checked by a monotonic guard and consumed immediately before MCP dispatch. Another waterfall listener cannot bypass Ask/Block by returning Allow. Revocation during an approval or scheduler wait prevents the call. Tool permissions do not sandbox subprocesses or protect against a malicious installed Host plugin with arbitrary Node authority.
