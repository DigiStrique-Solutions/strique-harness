# Harness 0.2.1-alpha.4 verification, 2026-10-16

Dependency pins and `engines.dsh` target Harness `0.2.1-alpha.4`. Syntax, behavior, and real Harness service integration checks pass without version exemptions. No running user profile was changed.

# Harness 0.2.0-rc.2 verification, 2026-10-01

Cordis peer and development dependencies now target `4.0.4`. `pnpm run check` and `pnpm test` pass (44 tests). The real Harness integration also passes:

```sh
HARNESS_PATH=../harness TSX_TSCONFIG_PATH=../harness/tsconfig.json node --import ../harness/node_modules/tsx/dist/loader.mjs tests/integration/harness.mjs
```

The target checkout reports Harness `0.2.0-rc.2`. Harness admission passes without exemptions. HTTP tests used isolated local servers with sandbox escalation. No running profile was changed; installed-profile and browser verification were not repeated.

# Secure MCP Manager verification

## 0.9.2 compatibility check, September 25, 2026

The local Harness checkout is `0.1.7-rc.2` at `477b4f420553e8a52c2fbccc464d7561b239c443`. This check used Node `24.21.0` on macOS arm64, Cordis `4.0.2` and MCP SDK `1.29.0`. No Host or Client runtime code change was needed.

| Check | Result |
| --- | --- |
| `pnpm check` | Passed |
| `pnpm test` | Passed, 44 synthetic tests |
| `HARNESS_PATH=../harness TSX_TSCONFIG_PATH=../harness/tsconfig.json node --import ../harness/node_modules/tsx/dist/loader.mjs tests/integration/harness.mjs` | Passed against the real 0.1.7-rc.2 registry, approval, authentication, agent scope and lifecycle services |
| Declaration check with Harness TypeScript, `--noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext` | Passed |
| Harness `evaluatePluginCompatibility()` on this manifest | No incompatibility reported for 0.1.7-rc.2 |

An isolated CLI package install could not finish because pnpm could not resolve its dependencies from the npm registry in this environment. An extracted archive in an isolated profile also could not boot the local Harness checkout: that checkout lacks built client bundles and a generated Typert entry. Neither failure indicates a plugin runtime error. Installed-profile HTTP and browser checks remain unverified for this release; the checks above used synthetic servers and did not change a running user profile.

The reviewed package is `artifacts/dsh-mcp-manager-secure-0.9.2.tgz`, SHA-256 `7cf278cba0b4578361fd7907131e5305e1abd494bb859c40ff0a908e691b911e`. Its ten manifest-allowlisted files contain no detected private paths or credential patterns, no install scripts, and Host, Client and declaration bytes identical to source.

## 0.9.1 permission fingerprint fix, September 15, 2026

Version 0.9.1 was verified against Harness `0.1.6-alpha.1`, source `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`, Cordis `4.0.2`, MCP SDK `1.29.0`, Node `26.4.0`, macOS arm64 and Playwright `1.59.1`. Development checks and packing used pnpm `10.33.0`; the source CLI installed the isolated profile with pnpm `11.7.0`.

The original description-change reproduction failed with `ask !== allow` before the fix. The operational permission fingerprint now excludes tool/schema titles and descriptions plus annotation titles. The full definition fingerprint still protects registration identity and rejects stale management writes. Schema property names and literal values named `title` or `description` remain significant. Legacy records preserve their current mode only on an exact saved-definition match; an existing Ask is never automatically restored to Allow.

| Command or check | Result |
| --- | --- |
| `pnpm check` | Passed |
| `pnpm test` | Passed, 44 tests including 11 new fingerprint/migration regressions |
| `TSX_TSCONFIG_PATH=../deepseek-harness/tsconfig.json node --import ../deepseek-harness/node_modules/tsx/dist/loader.mjs tests/integration/harness.mjs` | Passed, real registry/approval audit, documentation updates, Full access, meaningful changes, broker denial, Block, cancellation and lifecycle |
| `node ../deepseek-harness/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext lib/index.d.ts` | Passed |
| Plain Node import from the final installed Host artifact | Passed |
| `QA_TEST_TIMEOUT_MS=45000 qa-browser run dsh-mcp-fingerprint local smoke -- --grep 'MCP fingerprint isolated authenticated smoke'` | Passed |
| `QA_TEST_TIMEOUT_MS=45000 qa-browser run dsh-mcp-fingerprint local dsh-mcp-fingerprint -- --grep 'permissions: individual'` | Passed |
| Actual CLI add, remove and reinstall with `tests/integration/installed-profile.mjs installed`, `removed` and `restored` | All passed in isolated `artifacts/permission-fix/artifacts/release-home` |
| `git diff --check` | Passed |

The browser test uses `tests/integration/permission-browser-host.mjs` with the installed package. It selects the actual Harness Full access preset in a real session, then verifies successful MCP dispatch after a description update and zero dispatches after a meaningful schema update. The denied call contains the disabled-prompts explanation and renewed-review reason. Settings checks cover individual permissions, filtered bulk changes, empty search, reconnect, stale-write rejection, persistent review notices on the tool and server, and clearing notices after explicit review. The desktop screenshot was inspected; no browser page errors were recorded. Browser evidence: `/Users/poojan/.codex/browser-qa/output/dsh-mcp-fingerprint/local/2026-09-15T16-10-24-374Z/`. The fixture used port 55978 and was shut down after testing. No user server was stopped.

Final artifact: `artifacts/permission-fix/final/11b35ffc0ab4/dsh-mcp-manager-secure-0.9.1.tgz`, SHA-256 `11b35ffc0ab4d2c1fd0851fe704a4174f2ed395424adc546c24ca3cad1c5bc94`. Its ten allowlisted files were inspected for unintended local paths and credential patterns. It declares no install lifecycle scripts. The final installed Host, Client and declarations match the reviewed source byte for byte. The final repack changed only documentation relative to the browser-tested artifact; executable files are identical.

With user authorization, the final artifact was installed in the main `web` profile and its Harness server was restarted on port 3080. The installed executable files match the reviewed source; other profile dependencies and patch settings were preserved. All 227 saved permissions migrated to the versioned fingerprint without mode changes (112 Allow, 115 Ask). Meta Ads, Firecrawl and Resend reconnected with 97, 25 and 105 tools respectively. The authenticated manager API returned 200, the unauthenticated shell returned 401, and the main-profile authenticated browser smoke test passed. The prior package and a private backup of profile settings and MCP state remain available for rollback.

The npm package has not been published. No real provider tool calls or user permission changes were made. Live Meta operations, additional Harness/Node versions and phone layouts were not tested in this change. Prior historical reports below describe their own artifacts and compatibility targets.

Verified September 9, 2026. Local fork version `0.8.0`, branch `codex/secure-mcp-manager`. The 13 findings in the original audit have regression coverage and pass. This is evidence for the tested boundaries, not a claim that the plugin has no remaining vulnerabilities or supports every MCP provider.

## Provenance and artifact

- Original: `hyqhyq3/dsh-mcp-manager` `0.6.0`, commit `69d5cbc76e21606867f6dbef05025e2e2dfdbd04`. The separate vendor clone remains unchanged.
- Tested Harness: `0.1.5-alpha.1`, commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`.
- Tested platform: macOS arm64, Node `26.4.0`, pnpm `10.33.0`, Cordis `4.0.2`, MCP SDK `1.29.0`, Playwright `1.59.1` with its bundled Chromium.
- Artifact: `artifacts/53b83cb6e352/dsh-mcp-manager-secure-0.8.0.tgz`.
- SHA-256: `53b83cb6e352f06b99233c8c500c0ed895fcbdfac92a8187b0b28efbe32bbc8b`.
- Host JS SHA-256: `339085f0de43cf948ee57a9a8e6c095c47124ee9805d228e01e020425ace5a82`.
- Client JS SHA-256: `f6552f786c379afc26304062cc6920786d4bc52d82efb66f25af409b3af61253`.

The archive contains exactly ten intended files: Host and Client JavaScript, declarations, package manifest, bundle patch, license, English and Chinese README, changelog and security model. Tests, dependency directories, browser cookies, private state and launch logs are excluded. No install lifecycle scripts are declared. The package uses the Harness Cordis runtime through a peer dependency. The npm package is not published. This report records local verification before the source was prepared for GitHub as `DigiStrique-Solutions/strique-dsh-mcp-client`. Version 0.8.0 was installed in the user-authorized main workspace profile on port 3080 after the release checks below.

## Original findings

All thirteen tests in [tests/regressions.test.mjs](../tests/regressions.test.mjs) passed against the fixed implementation. The table below maps each original finding to its fix and verified behavior.

| Finding | Fix and verified behavior |
| --- | --- |
| 01. Unauthenticated and cross-origin process creation | Harness authentication and Host/Origin checks run before route effects. Unauthorized and cross-origin text/plain requests cannot mutate or spawn. |
| 02. Inherited environment leaks | A real stdio child receives only the allowed baseline environment and explicit entries, without unrelated secrets or `DSH_HOME`. |
| 03. Secrets returned by management API | Header and environment values are redacted; unauthorized reads fail. Existing secrets survive unrelated edits through Host-resolved markers. |
| 04. Reflected OAuth callback script | State is validated before error processing. Callback HTML is escaped and constrained by CSP. |
| 05. Automatic workspace command execution | A workspace command stays dormant until the exact definition is approved through the authenticated manager. |
| 06. Token reuse after workspace retarget | Configuration changes invalidate approval and endpoint-bound credentials. A second OAuth test obtains a real fixture token and verifies it is discarded before connecting to a changed endpoint. |
| 07. Editing a disabled server enables tools | Editing preserves disabled state and registers no tools. |
| 08. Disable during initialization leaks registrations | Cancellation and connection generations prevent delayed initialization from registering tools after disable. Delete during initialization has separate coverage. |
| 09. No-auth and custom-header endpoints cannot connect | Both connect through actual HTTP fixtures. |
| 10. Structured output lost and unsafe concurrency declaration | Canonical results retain content, structured data and MCP error flags. Scheduling is exclusive. The on-demand broker also preserves the canonical result. |
| 11. Tool cancellation ignored | Aborting execution cancels the pending MCP call and its actual HTTP request. |
| 12. Stdio exit leaves stale tools | A real child exit withdraws tools and performs a bounded reconnect. |
| 13. State ignores active home and permissions | `DSH_HOME` and profile identity determine storage. Directories use 0700, files 0600, writes replace atomically, and a live writer lock excludes another manager. |

Additional tests cover unsafe URLs, malformed argument/header objects, request and response limits, cyclic pagination, workspace symlinks, secret-preserving edits, delete races, a quiet SSE notification stream surviving the ordinary request timeout, PKCE, token exchange, callback expiry/state/single use, and registration rejection without secret reflection or background registration attempts.

## Commands and outcomes

Run from the fork root unless otherwise indicated.

| Check | Outcome |
| --- | --- |
| `pnpm check` | PASS: both JavaScript entries parse. |
| `pnpm test` | PASS: 31 tests, including all 13 original findings. |
| `TSX_TSCONFIG_PATH=../deepseek-harness/tsconfig.json node --import ../deepseek-harness/node_modules/tsx/dist/loader.mjs tests/integration/harness.mjs` | PASS: real Harness registry, authentication, agent create/resume, scope isolation, broker guard, persistence and Cordis lifecycle. |
| `node --input-type=module -e "await import('./lib/index.js')"` | PASS: plain Node Host entry. |
| `node ../deepseek-harness/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext lib/index.d.ts` | PASS: public declarations. |
| `pnpm audit --prod --json` | PASS: zero reported advisories across 96 production dependencies at the time of the check. This does not prove dependencies are vulnerability-free. |
| `git diff --check` | PASS. |
| `pnpm pack --pack-destination artifacts` | PASS: archive contents and checksum inspected. |
| `qa-browser run dsh-mcp-secure local smoke -- --grep 'isolated secure MCP'` | PASS: authenticated Harness shell and manager API. |
| `QA_TEST_TIMEOUT_MS=45000 qa-browser run dsh-mcp-secure local dsh-mcp-secure` | PASS: three browser scenarios described below. |

The real Harness integration uses its actual BrowserAuth, HostConnectionService, ToolRuntime, AgentRegistry and scope implementation. The agent factory is a controlled inert fixture with the correct setup contract. It proves PENDING before dependencies, ACTIVE after arrival, cleanup on provider withdrawal, restoration of global and already-running workspace scopes, and final disposal. A successful authorized broker call and a denied broker dispatch both run through the real registry.

## Packed profile lifecycle

The real `dsh plugin --profile web add <tarball> --ignore-scripts` and `remove dsh-mcp-manager-secure` commands were exercised under `artifacts/release-home`. The final tarball was reinstalled using its distinct checksum directory to avoid pnpm reusing an older same-version local file artifact.

`tests/integration/installed-profile.mjs` boots the actual CLI `runProfile` path with the normal package-name bundle row, isolated state, a clean environment, `--no-open`, and port 0. Its three modes run in separate processes:

1. `installed`: one active package row; unauthenticated API 401; authenticated shell and API; real tool execution; disabled configuration persisted.
2. `removed`: normal startup still works; no manager row, API route or MCP tools; authenticated shell remains available.
3. `restored`: one active row from the final tarball; the saved configuration remains disabled; an explicit edit and enable reconnect to a fixture and execute a real tool with its structured result preserved.

All three modes passed. Every mode disposes its own temporary test Host and confirms the writer lock is released. The tests do not stop the user's servers. The installed Host, Client and declaration files are compared byte-for-byte with the reviewed source. Raw startup logs remain local and private because Harness prints an ephemeral authentication URL.

To reproduce a mode after its corresponding CLI package operation:

```sh
DSH_HOME="$PWD/artifacts/release-home" \
TSX_TSCONFIG_PATH=../deepseek-harness/tsconfig.json \
node --import ../deepseek-harness/node_modules/tsx/dist/loader.mjs \
  tests/integration/installed-profile.mjs installed
```

Package membership is frozen at profile startup in this Harness version. Package removal alone does not unload an already-running Host. Separately, the preview's live composition was disabled and re-enabled: the manager route disappeared while its authenticated Harness shell stayed available. A preview-only overlay loads the installed artifact with a cache-busting URL to avoid restarting port 3198. Clear `artifacts/isolated-home/profiles/web/cordis.patch.yml` to `[]` before a future normal restart/removal of that preview profile. The independent fresh-start tests above use the normal package-name row with no such overlay.

## Browser evidence

Final scenario report directory:

`/Users/poojan/.codex/browser-qa/output/dsh-mcp-secure/local/2026-09-08T20-40-55-434Z/`

- Desktop add/connect, secret-preserving edit, disabled edit, enable, reconnect and remove: PASS.
- Actual cross-site OAuth navigation from a localhost fixture provider to the Harness 127.0.0.1 callback, followed by authenticated Continue navigation with its SameSite=Strict cookie: PASS. No exchange occurs on the unauthenticated landing page.
- Provider registration rejection: PASS. The visible message explains client compatibility, the failed popup closes, and the synthetic provider secret/script never appears.

Screenshots were inspected. Browser scenarios use only synthetic fixture data and leave the user's `meta_ads` definition intact. Tracing and video are disabled for these scenarios because tracing the persistent Harness SSE body stalled Playwright teardown; assertions, screenshots and the HTML report remain available. Early failed runs exposed test setup, locator and stale-module issues; the final three-scenario run passed against the reviewed JavaScript hashes.

## Meta Ads diagnosis and remaining limits

On the user's machine, `https://mcp.facebook.com/ads` returned HTTP 401 and a Bearer challenge pointing to its protected-resource metadata. Both that metadata and the authorization-server metadata returned HTTP 200. The provider advertised `https://mcp.facebook.com/.well-known/register/ads`, which rejected this manager's registration with HTTP 400 and `invalid_client_metadata`: dynamic registration is not available for this client.

This happened before browser login or a localhost callback. Localhost networking was working; changing to a public host is not a demonstrated remedy. The manager now displays a fixed, useful registration-rejection message, rather than the provider's raw response. Meta account authorization remains blocked by that compatibility restriction. No Meta account data or advertising operations were accessed.

- Not verified: actual Meta OAuth/account operations, other providers' special registration policies, reverse-proxy HTTPS callbacks, Windows process cleanup, or additional Node/Harness versions. The engine range follows Harness; only the platform/version above was tested.
- Not implemented: pre-registered OAuth client configuration and legacy SSE-only transport. Compatible Streamable HTTP may use SSE responses and notification streams, which are supported and tested.
- Phone usability is not passed: the upstream Harness Settings shell clips plugin content at 390px. Desktop flows pass.
- Local subprocesses still have the OS account's authority. Environment filtering is not sandboxing, and private files are not encryption against the same account. Untrusted MCP tool output can still attempt model prompt injection. See `SECURITY.md`.

## 0.8.0 permission verification and deployment

Eight new behavioral regressions cover conservative defaults despite read-only hints; explicit Allow and Block; one-use approvals; reject/cancel/unavailable outcomes; changes during approval; late answers after abort; authenticated and atomic validation; reconnect/enable persistence; changed and newly discovered tools; endpoint retarget; direct-body bypass rejection; durable state and deletion cleanup. All 31 regression tests pass.

The real Harness integration additionally uses its actual ApprovalService, ToolRuntime, AgentRegistry and agent scopes. It verifies audit pairs, missing answerers, two distinct one-time approvals, cancellation, timeout, stale grants, upstream waterfall short-circuit attempts, revocation during an asynchronous execution wrapper, workspace permission enforcement, broker approval with the visible root identifier, blocked broker calls and lifecycle withdrawal during a pending approval. The sessions in this integration are controlled fixtures; the browser scenario below uses an actual profile, session and browser Remote answerer.

`tests/integration/browser-approval-host.mjs` boots the actual installed package using `runProfile` in `artifacts/release-home`. Its temporary authenticated fixture invokes only a synthetic local MCP. A real browser clicks Allow once and Reject: the former sends exactly one MCP call, the latter sends none. Saved Ask remains unchanged. Block and Allow are also checked without interactive prompts. The fixture's session log and Host state are isolated from the main user profile. The fixture was shut down after testing.

Seven browser scenarios passed on the final package: server CRUD and secret preservation; OAuth callback across sites; provider registration rejection; Firecrawl reconnect; individual permissions, filtered bulk changes, empty search, persistence and stale-definition review; all Firecrawl defaults; and real Allow once/Reject execution. Screenshots for permission settings and the live approval prompt were inspected. The original settings shell still clips at phone widths; desktop is the tested target.

Browser evidence under `/Users/poojan/.codex/browser-qa/output/dsh-mcp-approval/local/`:

- `2026-09-08T21-48-35-136Z`: both permission settings scenarios pass.
- `2026-09-08T21-48-36-305Z`: actual browser approval and MCP dispatch pass.

The opt-in live Firecrawl test passed again with the final installed package: 25 tools discovered; all initially Ask; only the synthetic smoke server's scrape was explicitly allowed; an actual `https://example.com` scrape returned Example Domain; secret redaction, disable/enable, reconnect and removal passed. The temporary Firecrawl definition was removed afterward. The main Firecrawl definition remains entirely Ask.

The final checksum artifact was installed, removed and reinstalled through the actual CLI, and all three fresh-start profile modes passed with byte-for-byte source comparisons. `pnpm audit --prod` reported zero known advisories; declarations, plain Node import, JavaScript syntax, whitespace and credential-pattern scans passed. These are tested boundaries, not a guarantee of no vulnerabilities.

The existing port 3198 preview did not refresh its Host when its package changed. Its matching 0.7.0 package and overlay were restored without stopping that server. Release and UI tests used a fresh isolated startup instead. The main port 3080 was offline before installation and started fresh on 0.8.0. The main profile uses pnpm 11.7.0 and its existing v11 store, while the development and isolated release profiles used pnpm 10.33.0. No global package-manager configuration was changed. Existing main profile dependencies were preserved.

Main deployment: `/Users/poojan/Documents/ChatGPT/deepseek/.dsh/profiles/web`, artifact `/Users/poojan/Documents/ChatGPT/deepseek/.dsh/artifacts/53b83cb6e352/dsh-mcp-manager-secure-0.8.0.tgz`, backup `/Users/poojan/Documents/ChatGPT/deepseek/.dsh/backups/mcp-permissions-20260909-031801`. Verified listener on `127.0.0.1:3080`, anonymous HTTP 401, authenticated shell/API HTTP 200. Firecrawl is connected with 25 tools set to Ask; Meta Ads is saved in `needs-auth` and has not been authorized. Private launch logs and browser cookies are excluded from the package and source control.

Main-profile browser smoke and both permission scenarios passed after deployment. Evidence: `/Users/poojan/.codex/browser-qa/output/dsh-local/local/2026-09-08T21-55-30-049Z`. A dark-mode screenshot was captured; test server cleanup left only Firecrawl and Meta Ads configured. Private state files and directories were verified as 0600 and 0700.

## GitHub source preparation

The GitHub source snapshot preserves the tested Host and Client files. Repository metadata, title, ignore rules and the inherited agent guide were updated for the new repository. The deployed archive checksum above identifies the pre-publication artifact; repository metadata changes mean repacking this source will produce a different archive checksum. The npm package identity remains unchanged. Local launch logs, credentials and generated test evidence are excluded from Git.
