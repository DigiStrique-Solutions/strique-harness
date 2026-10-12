# Secure MCP manager

Target: DeepSeek Harness 0.1.7-rc.2, source 477b4f420553e8a52c2fbccc464d7561b239c443; Node 22.19+ or 24+, Cordis 4.0.2. Fork baseline: hyqhyq3/dsh-mcp-manager 0.6.0 at 69d5cbc.

One durable bundle row owns the authenticated management API, state, workspace configuration approvals, MCP connections, and tool registrations. Its Client half owns the Settings slot and editable forms. Management requires the Harness Connection service and its browser authentication and Host/Origin validation. OAuth callbacks additionally require the same browser session and a bounded, single-use state value tied to the resource and redirect origin.

HTTP transport and OAuth use MCP SDK 1.29.0. A bounded local stdio transport supplies the SDK's protocol client with a minimal environment and owned process-group cleanup. Tool calls preserve structured results, remain exclusive unless a future explicit contract allows concurrency, and propagate cancellation. Calls with external side effects are never replayed automatically.

Configuration and tokens belong to the active Harness home plus a hash of the root profile configuration URL. An explicit absolute stateDir is available for embedding and isolated tests. Files use restrictive modes, atomic replacement, and one live writer per state directory. The original shared home file is not automatically imported or executed.

Workspace definitions are untrusted. Files can propose commands and endpoints, but an authenticated UI action approves the exact normalized configuration fingerprint in Host-owned state. Changes require a new approval and invalidate endpoint-bound credentials. Tool dispatch rechecks the current file against the approved definition.

Every connection has an owner, abort controller and generation. Disable, delete, edit and unload invalidate old generations before waiting for cleanup. Retry applies only to reconnect/discovery, never to a tool call. Browser views expose configured secret keys and unchanged-value markers, not credential values.

Verification covers the 13 audited probes, real SDK HTTP and stdio behavior, OAuth callbacks, Harness authentication and tool registry, lifecycle cleanup, package install/removal, and browser settings interactions in an isolated profile. No changes to the user's running profile, package publication, or real account actions are needed to build and test this artifact.

## Tool permission flow (0.8.0)

The existing Host owns permission state and authenticated GET/PUT management routes. The browser presents searchable per-tool and bulk controls and only writes explicit user choices with the reviewed tool fingerprint. There is no new model-callable permission management tool. The Harness approval service remains the approval owner; no parallel callback, browser approval endpoint or custom grant store is exposed.

Execution flows through pre-execute policy, an optional one-call approval, the monotonic registry guard, and a final permission check inside the MCP definition immediately before network dispatch. The discovery broker recursively executes through the same registry and preserves the visible root call ID for approval correlation. Grants are opaque execution-token entries, consumed once and removed on tool results or manager disposal. Cancellation combines execution, lifecycle and the configured approval deadline. Stored choices survive connection recovery; a different configuration or operational definition produces a new permission fingerprint and requires review.

## Permission changes (0.9.1)

The Host retains the complete-definition fingerprint for current-generation checks and authenticated writes. A versioned operational fingerprint excludes tool and schema titles/descriptions and annotation titles, while preserving schema property names, literal values and other metadata. Wording updates preserve saved modes; meaningful changes reset to Ask and retain a review notice until an explicit permission save. Legacy records migrate only if their full definition matches. The existing approval service still audits rejected calls when prompts are disabled; the manager then explains the Ask/never conflict.
