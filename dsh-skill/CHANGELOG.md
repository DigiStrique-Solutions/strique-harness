## 0.4.2 (2026-10-05)

- Target Harness `0.2.1-alpha.1` and Cordis `4.0.5-alpha.1` and refresh the dependency lockfile.
- Preserve existing plugin behavior; compatibility checks pass without exemptions.
- Remove the unused dependency on the retired Harness invariants package.

# 0.4.1

- Target official Harness 0.1.7-rc.2 and its Cordis 4.0.4 peer.
- Migrate preset access to the revised registry and lease scoped reads for cold conversations.
- Read the new tool-result message shape when projecting skill loads.
- Rebuild the lockfile and pass all 83 plugin tests.

# 0.4.0

- Move skills readiness, progressive loading, invocation policy and provenance into the plugin using public Harness APIs.
- Support official 0.1.6-alpha.1 packages without a core fork or vendored Harness code.
- Handle preset tool precedence and suppress competing upstream skill injections before dispatch.
- Resolve restrictions from the actual composed preset and distinguish source defaults from per-skill overrides.
- Block loading when policy is unavailable and require review of old nonempty source rules.
- Keep cached-token, stale-response, coherent-preview and shared-update-snapshot repairs.
- Explain the policy boundary and unavailable external shadow/watcher details accurately.

# 0.3.2

- Restore compatibility with the paired patched 0.1.6-alpha.1 Harness.
- Count cached input and show its breakdown; prevent stale Context refreshes and mixed-source previews.
- Use the latest catalog for current summaries while retaining load history.
- Batch updates by source/ref with atomic group publication and shared snapshot storage.
- Read legacy recorded source metadata and emit the current sourceIdentity contract.

# 0.3.1

- Send each recorded tool catalog once in Context responses while retaining every request, tool description and usage record, avoiding response-limit failures in long chats.
- Return canonical RPC failure details so the browser displays the original business error.

# 0.3.0

- Add source-qualified inventory, discovery diagnostics, inactive imports and privileged instruction previews.
- Add persistent Off, Manual and Automatic access rules for DSH, explicit shared-source review and revision-checked migration.
- Enforce policies in the compatible Harness registry and loader; preserve a profile-owned guard when the bundle is removed.
- Separate current summaries, successful instruction loads, historical events and recorded request tool schemas in Context.
- Retain known provenance on new loads and label missing historical metadata and token estimates.
- Replace the private-library-only entry view with searchable inventory rows, source controls and details; retain Imported copies.

# 0.2.1

- Preserve complete validated source layouts and hash shared files and directories.
- Retain published resource versions across update, removal and restart; enforce storage limits before publication.
- Preserve successful commit results when cleanup fails, log maintenance warnings and retry cleanup safely.
- Treat constructor as an ordinary skill name and reject mutations of nonexistent entries.
- Show per-entry malformed/duplicate diagnostics while allowing valid selections; invalid upstream metadata reports unknown.
- Reject unresolved Git LFS assets and submodule sources with export instructions.
- Offer legacy subtree installations an explicit layout upgrade without relocating their resources.
- Add TDD regressions, browser import diagnostics coverage and real Harness slash/tool/session-replay verification.

# 0.2.0

- Private fork with a distinct package, Loader row, Client module, RPC route, and storage directory.
- English UI, accessible labels, loading/empty/error/read-only states, and explicit import review.
- Replaced the skills CLI with bounded structured discovery and descriptor-relative snapshot copying.
- Addressed the eight original regression cases; follow-up findings are fixed in 0.2.1; added regression and lifecycle tests.
- Mounted authenticated HTTP using the plugin's own webServer dependency, avoiding the upstream Connection injection workaround.
- Use Harness secondary text tokens for legible light and dark themes.
- Removed Settings navigation DOM mutation and tied styles and Client requests to plugin disposal.
- Pin Harness compatibility to the tested 0.1.5-alpha.1 prerelease.
