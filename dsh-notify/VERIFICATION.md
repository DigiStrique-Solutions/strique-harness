# 0.1.4: Harness 0.2.1-alpha.1 verification, 2026-10-05

Exact published Harness dependencies target `0.2.1-alpha.1`; Cordis support packages and lockfiles match the current checkout. `pnpm check`: 10 tests passed, including matching-runtime peers, pending interactions, completion sounds, settings persistence, and teardown. The current checkout’s `evaluatePluginCompatibility` admits the plugin without exemptions. The existing web profile links this checkout. No running process was restarted.

# Compatibility verification

## Current 0.1.4 repair (2026-09-29)

Harness 0.2.0-rc.1, Cordis 4.0.4, Schemastery 3.18.4, Node 26.4.0, pnpm 10.33.0, macOS with bundled Playwright Chromium.

The installed 0.1.3 bundle was disabled and its exact `dsh-settings@0.1.7-rc.2` peer was rejected by current Harness admission. A regression using the real admission evaluator failed before the peer update and passed afterward. Current session snapshots, pending-interaction publications, settings Config projection, and configForms remain compatible, so runtime code changes were unnecessary.

Passed:

- Syntax checks and all 9 portable Node tests, including admission, configuration validation, completion/subagent filtering, pending-event deduplication, preferences, and cleanup/remount.
- Supported CLI installation of the packed archive with scripts disabled into an isolated web profile.
- Real browser module-loader activation, byte equality of the served Client with the packed implementation, and English Notifications settings.
- A test click scheduled three real Web Audio oscillator notes; a test notification invoked the browser notification boundary. Approval, question, and plan-review publications through the real uiSession service each emitted one notification and their chime.
- Volume persistence, disposal of the settings slot and style, and one clean activation after reload. No browser page errors.
- Independent serverless profile boot through the real CLI Loader: Notify ACTIVE after install, absent after removal, and ACTIVE after reinstall. Installation scripts are absent and the package contains only the intended seven files.

Browser verification replaces OS notification delivery with a recording stub and observes real AudioContext scheduling. Physical speaker audibility, real OS banner delivery, and model-provider round trips are not claimed. Notification permission remains a user-gesture action; there is no automatic permission request or bypass. Test profiles use synthetic events and do not send model messages. Existing origin-scoped preferences and session-title previews remain documented limitations.

Repair evidence is retained locally in the parent workspace under `.dsh/repairs/notify-20260929`; browser artifacts are under the shared QA harness. The test authentication URL stays in a protected, untracked file.

### Live activation

Notify 0.1.4 was installed via the supported CLI and enabled with the public profile writer after successful compatibility evaluation. The Harness was restarted on port 3080; authenticated inventory confirms Notify loaded. The live browser check verifies the installed Client bytes and opens the Notifications settings page. All 130 pre-existing session files remain present. The temporary server on port 3217 was stopped after verification.

The first live browser attempt clicked Settings during preview-notice dismissal and did not open the modal. Explicitly waiting for the notice to disappear and the app root to leave its inert state fixes the test race. The updated live smoke and complete isolated scenario both pass. No production runtime workaround was added.

Final artifact: parent workspace `.dsh/artifacts/notify/0.1.4/final/dsh-notify-0.1.4.tgz`. Final runtime and manifest bytes match the browser-tested archive exactly. Profile backup: `.dsh/backups/notify-0.1.4-20260929`.

## Historical 0.1.3 build (2026-09-25)

- Plugin: `dsh-notify@0.1.3`; target: Harness `0.1.7-rc.2`, Cordis `4.0.4`, Schemastery `3.18.4`.
- Checked against the local Harness checkout tagged `dsh-v0.1.7-rc.2`: settings configuration, Client config form, session status, and settings slot contracts.
- `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm check` pass (8 tests).
- `npm pack --ignore-scripts` produced `dsh-notify-0.1.3.tgz` with seven intended files. SHA-256: `249a10e9bc0c87108ce67287f92efaf719728f60f96438ffeb25e84ec9a8267c`.
- A live Harness browser run and installation into the user's profile have not been performed for this build.

## Historical 0.1.1 verification

Date: 2026-09-15

## Target and release artifact

- Upstream: `dshiq04/dsh-notify`, commit `50c36dc969c7c0ef28b5b98f5fbc873669be3496`.
- Local branch: `codex/harness-compatibility`.
- Plugin: `dsh-notify@0.1.1`.
- Harness: `0.1.6-alpha.1`, checkout `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`.
- Cordis: `4.0.2`; Schemastery: `3.18.2`.
- Node: `26.4.0`; pnpm: `10.33.0`; Playwright: `1.59.1`; platform: macOS, bundled Chromium.
- Artifact: `dsh-notify-0.1.1.tgz`.
- Release SHA-256: `11e8bd7066f613db35bcec8101232b2e8ca83bb2a619d08fdcbcdde32e1bd129`.
- Private distribution: `DigiStrique-Solutions/dsh-notify`, GitHub release `v0.1.1`.
- The earlier local-install archive has SHA-256 `7275a689cf554886e52b5b3c5398f599487d9355ee0b8777b7fe2b4f2338a5d2`. Release metadata, portable development dependencies, documentation, and license were added afterward. Host, Client, and Cordis patch bytes match that activated archive exactly.

## Passed checks

1. `pnpm check`: JavaScript syntax checks and 8 portable Node tests. Covers current settings registration, invalid configuration, provider withdrawal/restoration, initial and replacement pending requests, completion chimes, suppression preferences, English text, persistence when the Host mirror rejects, and unload/remount cleanup.
2. `npm pack --ignore-scripts`: seven intended files, approximately 11.4 kB compressed. No installation lifecycle scripts, tests, credentials, bundled dependencies, or machine paths are embedded in runtime assets. All development dependencies use pinned registry versions; no sibling-checkout links are shipped.
3. Plain Node import of the unpacked Host entry with the matching built peer packages available. Schema defaults and required settings service verified.
4. Isolated CLI installation and `--dump-config`: one `dsh-notify` row and bundle. CLI removal removes both; reinstall succeeds. The release archive was installed into a fresh temporary `release-check` profile. Real Loader boot and disposal were then exercised with startup-frozen profile patches: the notification fiber was ACTIVE after installation, absent after removal, and ACTIVE after reinstallation. No FAILED rows were observed.
5. `DSH_NOTIFY_TEST_HOME=/tmp/dsh-notify-verify-20260915 qa-browser run dsh-notify-isolated dev smoke`: plugin activates through the real browser module loader without page errors.
6. `DSH_NOTIFY_TEST_HOME=/tmp/dsh-notify-verify-20260915 qa-browser run dsh-notify-isolated dev dsh-notify-isolated`: current packed Client bytes confirmed in served scripts; English settings render; sound test schedules three real Web Audio oscillator notes; approval, question, and plan-review publications through the real `uiSession` service each notify; preferences persist; disposing the plugin removes its styles and settings entry; refresh activates it once. No page errors.
7. `git diff --check` passes. No Chinese text remains in plugin runtime, documentation, metadata, or tests.

The browser test captures the plugin context through test-only response instrumentation. Notification delivery is recorded by a browser stub, and Web Audio scheduling is observed on real AudioContext nodes. It does not claim physical speaker audibility, real OS banner delivery, or a model-driven MCP approval round trip.

## Test setup

The global QA profile `dsh-notify-isolated` targets `http://127.0.0.1:3217`. Its test entry registers `test/browser.spec.ts` using the global harness's Playwright instance. `DSH_NOTIFY_TEST_HOME` must point to an isolated home containing a protected `launch-url` file with that test server's startup URL. Authentication material is not committed; trace and video are disabled for the authenticated test.

The temporary server uses `/tmp/dsh-notify-verify-20260915`, separate from the user's active Harness home. The browser QA server remains separate from the active profile. Release lifecycle checks additionally booted and disposed a serverless base profile after installation, removal, and reinstallation. Full web-server restart after removal was not repeated; Client disposal and refresh were separately exercised in the browser.

The CLI reports missing peer warnings in the standalone temporary profile. The Harness resolver supplies the matching built runtime peers during actual activation; the browser and Host checks passed with that setup. A standalone Node consumer must supply those peers explicitly.

## Deferred scope

Account/tenant-specific preferences, authenticated event filtering, RBAC, preview privacy, logout clearing, and Web Push remain future work. The earlier local-install archive is active in the user's web profile. An authenticated live browser check verified the notification fiber, English settings, enabled notifications and sound, and preservation of all 33 sessions. The user confirmed sound is working. Publication does not restart or modify that running profile. Compatibility with other Harness prereleases is unverified.

## Release checks (2026-09-15)

- Passed: `pnpm install --ignore-scripts` with pinned published development dependencies, followed by `pnpm check` (8 tests).
- Passed: release tarball allowlist, plain Node Host import, and byte comparison against the activated Host/Client/patch.
- Passed: fresh-profile add, dump, remove, and reinstall. The first removal command incorrectly included the unsupported pnpm `remove --ignore-scripts` option; rerunning the documented removal command succeeded.
- Passed: real serverless profile boot after add, removal, and reinstall through `runProfile`, with startup-frozen patch configuration. An initial test-only live-watcher setup failed because the HMR service was unavailable; using the supported startup-frozen profile lifecycle resolved the test setup.
- Passed: browser smoke and full notification scenario through `qa-browser`, using the identical release Client runtime bytes.
- Passed: final whitespace, English-text, and tracked-source secret-pattern checks.
- Not applicable: npm publication. Distribution is a private GitHub release; `private: true` prevents accidental npm publication.
