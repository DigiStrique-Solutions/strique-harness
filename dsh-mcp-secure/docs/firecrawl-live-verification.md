# Firecrawl live verification

Verified September 9, 2026 (Asia/Kolkata), using the user's authorized API key.

Firecrawl is configured and remains enabled in the isolated preview on port 3198. Its hosted endpoint is `https://mcp.firecrawl.dev/v2/mcp`, with the key supplied through the private Authorization header. This follows [Firecrawl's official MCP setup](https://github.com/firecrawl/firecrawl-mcp-server#hosted-mcp-keyless-free-tier). The key is absent from the endpoint URL, this report, and test source.

## Results

| Check | Result |
| --- | --- |
| Preview browser authentication smoke | PASS |
| Preview connects to Firecrawl | PASS, 25 tools |
| Full packed plugin loaded through real Harness Loader in a separate test profile | PASS, installed JavaScript matches reviewed source |
| Real tool execution through Harness's native registry | PASS, `firecrawl_scrape` returned “Example Domain” from `https://example.com` |
| Disable, enable and reconnect | PASS, tools removed and restored with no duplicates |
| Browser secret-preserving edit, switches and reconnect | PASS |
| Secret redaction | PASS, key absent from API responses, tool result, browser DOM, text reports and provider test log |
| Secret storage | Preview state file permissions 0600 |
| Test-profile cleanup | PASS, Firecrawl definition and key removed, Host disposed and writer lock released |

The live scrape ran through the installed manager and actual Harness tool registry in the separate `artifacts/release-home` profile. The browser checks and persistent Firecrawl configuration use the running preview. No Codex Firecrawl connector was used for this test. The preview server was not restarted or stopped. Meta's existing connection error remains; this API-key test does not validate Meta's OAuth flow.

The first browser run checked status before the reconnect request completed. The corrected test waits for each mutation's response; the final run passed. No plugin implementation changes were required.

## Evidence

- Provider result: `artifacts/firecrawl-live-report.json`.
- Opt-in provider test: `tests/integration/firecrawl-live.mjs`, requiring `DSH_LIVE_FIRECRAWL=1` and the isolated release-test home. It reads only the already configured Firecrawl credential from private preview state.
- Browser scenario: `/Users/poojan/.codex/browser-qa/tests/dsh-firecrawl-live.spec.ts`.
- Final browser report: `/Users/poojan/.codex/browser-qa/output/dsh-mcp-secure/local/2026-09-08T21-09-20-060Z/html-report/index.html`.

One public page was scraped. Bulk crawl, agent research, paid higher-cost operations and OAuth were not exercised. All 25 tools were discovered; only the scrape tool's provider operation was tested.
