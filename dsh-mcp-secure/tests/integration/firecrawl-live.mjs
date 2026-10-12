// Opt-in provider smoke. Reads only the Firecrawl secret already configured in
// the local preview; never embeds credentials in this test or its report.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.DSH_LIVE_FIRECRAWL, '1', 'Requires explicit live-provider opt-in');
assert.equal(process.env.DSH_HOME, resolve('artifacts/release-home'));
const previewRoot = resolve('artifacts/isolated-home/mcp-manager-secure');
let credential;
for (const dir of readdirSync(previewRoot)) {
  const path = join(previewRoot, dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const server = state.servers.find(s => s.name === 'firecrawl' && s.url === 'https://mcp.firecrawl.dev/v2/mcp');
  if (!server) continue;
  assert.equal(statSync(path).mode & 0o777, 0o600);
  credential = server.headers.Authorization;
}
assert.ok(credential?.startsWith('Bearer fc-'), 'Configure Firecrawl in the preview first');
const secret = credential.slice(7);
const harness = resolve('../deepseek-harness');
const mod = path => import(pathToFileURL(join(harness, path)).href);
const { runProfile } = await mod('apps/cli/src/profile-boot.ts');
const { createLaunchEnvironmentSnapshot } = await mod('packages/util/launch-environment/src/index.ts');
const { FiberState } = await mod('vendor/cordis/src/index.ts');
let app, api, serverId, previousOnDemand;
const report = { testedAt: new Date().toISOString(), endpoint: 'https://mcp.firecrawl.dev/v2/mcp', checks: [] };
async function until(check) {
  const deadline = Date.now() + 60000;
  do { if (await check()) return; await new Promise(r => setTimeout(r, 200)); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for Firecrawl tool registration');
}
try {
  app = await runProfile({ profile: 'web', patchFiles: [], args: ['--port', '0', '--no-open'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) });
  const ctx = app.ctx;
  const entry = [...ctx.loader.entries()].filter(e => e.options.name === 'dsh-mcp-manager-secure');
  assert.equal(entry.length, 1); assert.equal(entry[0].fiber.state, FiberState.ACTIVE);
  const installed = join(process.env.DSH_HOME, 'profiles/web/node_modules/dsh-mcp-manager-secure');
  for (const file of ['index.js', 'client.js']) assert.ok(readFileSync(join(installed, 'lib', file)).equals(readFileSync(join('lib', file))), 'Installed artifact differs from reviewed source');
  report.checks.push('Real Loader and matching installed artifact');
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' });
  const cookie = launch.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  api = async (method, path, body) => {
    const response = await fetch(base + '/mcp-manager/api' + path, { method, headers: { cookie, origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70000) });
    const text = await response.text();
    assert.ok(!text.includes(secret), 'API response exposes the credential');
    assert.ok(response.ok, `Manager API HTTP ${response.status}`);
    return JSON.parse(text);
  };
  previousOnDemand = (await api('GET', '/settings')).onDemandToolInjection;
  if (previousOnDemand) await api('POST', '/settings/on-demand', { enabled: false });
  for (const s of (await api('GET', '/servers')).servers) if (s.name === 'firecrawl_live') await api('DELETE', `/servers/${s.id}`);
  const added = await api('POST', '/servers', { name: 'firecrawl_live', type: 'http', url: report.endpoint, authMode: 'static', headers: { Authorization: credential } });
  serverId = added.server.id;
  const toolName = 'mcp__firecrawl_live__firecrawl_scrape';
  const tools = () => ctx.tools.schemas().filter(t => t.name.startsWith('mcp__firecrawl_live__'));
  await until(() => tools().some(t => t.name === toolName));
  report.toolCount = tools().length;
  assert.ok(report.toolCount > 3, 'Expected authenticated account tools');
  report.checks.push('Authenticated discovery and native Harness tool registration');
  const permissions = await api('GET', `/permissions/${serverId}`);
  assert.ok(permissions.tools.every(t => t.mode === 'ask'));
  const scrape = permissions.tools.find(t => t.name === 'firecrawl_scrape'); assert.ok(scrape);
  await api('PUT', `/permissions/${serverId}`, { changes: [{ ...scrape, mode: 'allow' }] });
  report.checks.push('All discovered tools default to Ask; only the smoke scrape receives explicit Allow');
  const result = await ctx.tools.execute({ signal: AbortSignal.timeout(60000), callId: 'firecrawl-live-scrape', name: toolName, arguments: { url: 'https://example.com', formats: ['markdown'] } });
  const raw = JSON.stringify(result);
  assert.ok(!raw.includes(secret), 'Tool result exposes the credential');
  assert.equal(result.isError, false, 'Harness reported a scrape failure');
  assert.ok(raw.includes('Example Domain'), 'Scrape did not return expected public content');
  report.scrape = { url: 'https://example.com', expectedText: 'Example Domain', matched: true, resultBytes: Buffer.byteLength(raw) };
  report.checks.push('Real Firecrawl scrape through ctx.tools.execute and credential-free result');
  await api('POST', `/servers/${serverId}/enabled`, { enabled: false });
  assert.equal(tools().length, 0);
  await api('POST', `/servers/${serverId}/enabled`, { enabled: true });
  await until(() => tools().length === report.toolCount);
  await api('POST', `/servers/${serverId}/connect`, {});
  await until(() => tools().length === report.toolCount);
  assert.equal(new Set(tools().map(t => t.name)).size, report.toolCount);
  report.checks.push('Disable removes tools; enable and reconnect restore without duplicates');
  await api('DELETE', `/servers/${serverId}`); serverId = undefined;
  assert.equal(tools().length, 0);
  report.checks.push('Test-server removal unregisters tools');
} finally {
  if (serverId) await api('DELETE', `/servers/${serverId}`).catch(() => {});
  if (api && previousOnDemand !== undefined) await api('POST', '/settings/on-demand', { enabled: previousOnDemand });
  await app?.shutdown.shutdown(0);
}
writeFileSync('artifacts/firecrawl-live-report.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('PASS: live Firecrawl discovery, native tool execution, reconnect, redaction and cleanup.');
