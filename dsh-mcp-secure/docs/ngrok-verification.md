# HTTPS callback verification, 0.9.0

Verified September 9, 2026 against Harness `0.1.5-alpha.1`, Cordis `4.0.2`, MCP SDK `1.29.0`, and Node `26.4.0` on macOS arm64. This supplements the historical [0.8.0 report](verification.md).

Meta rejected dynamic client registration for this installation. A public callback URL alone does not resolve that rejection. Version 0.9.0 supports a pre-registered public client ID and an explicitly configured HTTPS origin. The user-supplied Meta App ID is now configured, and the generated authorization URL was verified to contain that ID, the exact registered HTTPS callback, S256 PKCE, OAuth state and the Meta Ads resource. Real Meta consent and token exchange remain unverified; the completed round-trip tests below use an inert OAuth provider.

## Artifact and checks

Artifact: `dsh-mcp-manager-secure-0.9.0.tgz`.

SHA-256: `4ae305f909dceff2158dce04752645bc087ceaf1528f68468febb1500d19c38e`.

| Check | Result |
| --- | --- |
| `pnpm check` | Pass |
| `pnpm test` | 33 tests passed, including all 13 original regressions |
| TypeScript declaration check | Pass |
| Existing real Harness integration | Pass: policy enforcement, approval, cancellation, scope isolation and lifecycle |
| Package inspection | Exactly ten intended files; no tests, credentials or private state |
| Real Loader public-origin integration | Pass: installed artifact, live replacement, registered client, HTTPS callback, authentication, cross-origin rejection and staged rollback |
| Actual ngrok HTTPS API | Unauthenticated request 401; authenticated request 200; authenticated cross-origin request 403 |
| Actual ngrok OAuth round trip | Cross-site anonymous landing performs no exchange; authenticated same-origin continuation exchanges with the exact HTTPS callback; replay rejected with 400 |
| Public browser smoke | Pass: authenticated shell and manager API through HTTPS |
| Public browser settings | Pass: secure MCP settings remain available; Meta, Firecrawl and Resend are present; Firecrawl and Resend connected; no Firecrawl key exposed in page content |

The configured-client and proxy cases were reproduced as failing tests before the implementation changes. Changing the configured client invalidates the previous client's credentials. The proxy cannot select callback URLs through forwarded headers.

To reproduce the Loader test after installing the archive into the isolated release profile:

```sh
DSH_HOME="$PWD/artifacts/release-home" \
TSX_TSCONFIG_PATH=../deepseek-harness/tsconfig.json \
node --import ../deepseek-harness/node_modules/tsx/dist/loader.mjs \
  tests/integration/proxy-oauth.mjs
```

Live verification used the authenticated running profile through ngrok, with request inspection disabled. It created and removed one synthetic OAuth server. Firecrawl and Resend remained connected after cleanup. No email, advertisement, or other business action was executed.

## Deployment and recovery

The main profile was updated with the actual Harness plugin installer. Its package identity is unchanged. The public hostname is added explicitly to the existing trusted hosts; authentication remains enabled. The current process loads the new installed entry through a persistent composition replacement because package modules already imported by Node remain cached. The original manager row is disabled to avoid two state writers.

Backups, the installed entry path, artifact checksum, and public callback are recorded privately in the workspace's `.dsh/ngrok-meta/deployment.json`. Recover a live composition in stages: withdraw the replacement and wait for its routes to disappear before enabling the normal package row. The isolated integration verifies this sequence. Do not overwrite unrelated profile changes from another task when restoring a backup.

Ngrok still depends on the local app running. An independent task temporarily interrupted port 3080 during its installation, causing ngrok to return 502. That task restored the app. The public API and both browser checks passed afterward, with port 3080 listening and unauthenticated public management requests still rejected with 401. No local server was stopped for the App ID configuration change. Meta authorization remains pending user consent.
