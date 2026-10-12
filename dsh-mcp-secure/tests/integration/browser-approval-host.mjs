// Ephemeral real-profile fixture. Never use with a user's primary Harness home.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureServer } from '../helpers.mjs';
assert.equal(process.env.DSH_HOME, resolve('artifacts/release-home'));
const harness = resolve('../deepseek-harness');
const mod = path => import(pathToFileURL(join(harness, path)).href);
const { runProfile } = await mod('apps/cli/src/profile-boot.ts');
const { createLaunchEnvironmentSnapshot } = await mod('packages/util/launch-environment/src/index.ts');
const { createToolResultMessage } = await mod('packages/llm/llm/src/index.ts');
const fixture = await fixtureServer();
const app = await runProfile({ profile: 'web', patchFiles: [], args: ['--port', '3199', '--no-open'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) });
const ctx = app.ctx, base = 'http://127.0.0.1:3199';
const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' });
const cookie = launch.headers.get('set-cookie').split(';')[0], [cookieName, ...cookieValue] = cookie.split('=');
const api = async (method, path, body) => {
  const r = await fetch(base + '/mcp-manager/api' + path, { method, headers: { cookie, origin: base, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(r.ok, 'Fixture setup HTTP ' + r.status); return r.json();
};
for (const s of (await api('GET', '/servers')).servers) if (s.name === 'approval_fixture' || s.name === 'firecrawl') await api('DELETE', `/servers/${s.id}`);
const added = await api('POST', '/servers', { name: 'approval_fixture', url: fixture.url, authMode: 'static' });
for (const dir of readdirSync('artifacts/isolated-home/mcp-manager-secure')) {
  const state = JSON.parse(readFileSync(join('artifacts/isolated-home/mcp-manager-secure', dir, 'state.json'), 'utf8'));
  const s = state.servers.find(s => s.name === 'firecrawl' && s.url === 'https://mcp.firecrawl.dev/v2/mcp');
  if (s) await api('POST', '/servers', { name: 'firecrawl', url: s.url, authMode: 'static', headers: s.headers });
}
const created = await ctx.sessionController.create({ cwd: resolve('tests/fixtures') });
await ctx.sessionController.rename({ sessionId: created.sessionId, title: 'MCP permission browser test' });
const resolved = await ctx.sessionController.resolveAgent(created.sessionId); assert.ok(resolved.agent); const agent = resolved.agent;
const calls = () => fixture.requests.filter(r => r.body.method === 'tools/call').length;
agent.session.append('turn/start', { turn: 1 });
agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
let turn = 1, pending = false;
ctx.webServer.register({ kind: 'prefix', path: '/permission-fixture', async handler(req, res) {
  const reject = ctx.connection.requestRejection(req); if (reject) { res.writeHead(reject); res.end(); return; }
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/permission-fixture/status' && req.method === 'GET') return json(200, { calls: calls(), pending, serverId: added.server.id, sessionId: created.sessionId });
  if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return json(405, {});
  if (req.url === '/permission-fixture/stop') {
    if (pending) return json(409, {});
    await api('DELETE', `/servers/${added.server.id}`);
    for (const s of (await api('GET', '/servers')).servers) if (s.name === 'firecrawl') await api('DELETE', `/servers/${s.id}`);
    json(200, { ok: true }); await fixture.close(); await app.shutdown.shutdown(0); return;
  }
  if (req.url !== '/permission-fixture/call' || pending) return json(409, {});
  pending = true; const callId = `browser-approval-${++turn}`, toolName = 'mcp__approval_fixture__inspect';
  agent.session.append('turn/start', { turn });
  const event = agent.session.append('tool/call', { turn, step: 1, callId, name: toolName, arguments: '{}' });
  try {
    const result = await ctx.tools.execute({ agent, callId, name: toolName, arguments: {}, signal: AbortSignal.timeout(20000) });
    agent.session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [event.seq] });
    json(200, { isError: result.isError, calls: calls() });
  } catch { json(500, { error: 'Fixture execution failed' }); }
  finally { agent.session.append('turn/end', { turn, reason: { kind: 'completed' } }); pending = false; }
} });
const authDir = '/Users/poojan/.codex/browser-auth/dsh-mcp-approval'; mkdirSync(authDir, { recursive: true, mode: 0o700 });
writeFileSync(join(authDir, 'local.json'), JSON.stringify({ cookies: [{ name: cookieName, value: cookieValue.join('='), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' }], origins: [] }), { mode: 0o600 });
writeFileSync('/Users/poojan/.codex/browser-qa/profiles/dsh-mcp-approval.json', JSON.stringify({ project: 'dsh-mcp-approval', baseUrl: base, defaultPath: '/' }));
console.log('READY: real profile approval fixture on port 3199.');
