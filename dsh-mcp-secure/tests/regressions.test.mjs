import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { host, fixtureServer, until } from './helpers.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url));
const execution = signal => ({ signal: signal ?? new AbortController().signal });
async function add(h, payload) {
  const r = await h.api('POST', '/api/servers', payload);
  assert.equal(r.status, 201, r.body); return r.json().server;
}
async function connected(h, name) {
  const fullName = `mcp__${name}__inspect`;
  await until(() => h.tools.has(fullName));
  const tool = h.tools.get(fullName), id = tool.mcpPermission.serverId;
  const view = (await h.api('GET', `/api/permissions/${id}`)).json();
  assert.equal((await h.api('PUT', `/api/permissions/${id}`, { changes: view.tools.map(t => ({ ...t, mode: 'allow' })) })).status, 200);
  return { ...tool, execute: (args, exec) => h.ctx.tools.execute({ ...exec, name: fullName, arguments: args }) };
}
function workspace(dir, definitions) {
  mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
  writeFileSync(join(dir, '.dsh/dshmm/mcp.json'), JSON.stringify({ mcpServers: definitions }));
}
async function workspaceView(h) { return (await h.api('GET', '/api/workspaces')).json().workspaces[0]; }
async function approve(h) {
  const ws = await workspaceView(h), server = ws.servers[0];
  const r = await h.api('POST', '/api/workspaces/approve', { path: ws.path, name: server.name, fingerprint: server.fingerprint });
  assert.equal(r.status, 200, r.body); return server;
}

test('01: unauthorized requests and cross-origin text/plain writes cannot mutate or spawn', async t => {
  const h = host(); t.after(() => h.close());
  const payload = { name: 'attack', type: 'stdio', command: process.execPath, args: [fixture] };
  for (const headers of [{ cookie: '' }, { origin: 'https://untrusted.example' }, { 'content-type': 'text/plain' }, { host: 'untrusted.example' }]) {
    const r = await h.api('POST', '/api/servers', payload, headers);
    assert.ok([401, 403, 415].includes(r.status));
  }
  assert.deepEqual((await h.api('GET', '/api/servers')).json().servers, []);
  assert.equal(h.tools.size, 0);
});

test('02: a real stdio child receives only approved environment values', async t => {
  const previous = process.env.DEEPSEEK_API_KEY, previousHome = process.env.DSH_HOME;
  process.env.DEEPSEEK_API_KEY = 'synthetic-host-secret'; process.env.DSH_HOME = '/synthetic/home';
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; });
  const h = host(); t.after(() => h.close());
  await add(h, { name: 'env', type: 'stdio', command: process.execPath, args: [fixture], env: { FIXTURE_KEY: 'explicit-fixture' } });
  const result = await (await connected(h, 'env')).execute({}, execution());
  assert.deepEqual(result.structuredContent, { inherited: null, dshHome: null, explicit: 'explicit-fixture' });
});

test('03: management views redact literal secrets and unauthorized reads fail', async t => {
  const f = await fixtureServer(); t.after(() => f.close()); const h = host(); t.after(() => h.close());
  await add(h, { name: 'secrets', url: f.url, authMode: 'static', headers: { Authorization: 'synthetic-private-header' } });
  const view = await h.api('GET', '/api/servers');
  assert.ok(!view.body.includes('synthetic-private-header'));
  assert.equal(view.json().servers[0].headers.Authorization, '__DSH_KEEP_CONFIGURED_SECRET__');
  assert.equal((await h.api('GET', '/api/servers', undefined, { cookie: '' })).status, 401);
  assert.equal((await h.api('GET', '/api/workspaces', undefined, { cookie: '' })).status, 401);
});

test('04: OAuth callback validates state before errors and cannot reflect scripts', async t => {
  const f = await fixtureServer(); t.after(() => f.close()); const h = host(); t.after(() => h.close());
  const s = await add(h, { name: 'oauth', url: f.url });
  const r = await h.api('GET', `/callback/${s.id}?error=${encodeURIComponent('<script>alert(1)</script>')}&state=forged`);
  assert.equal(r.status, 400); assert.ok(!r.body.includes('<script>')); assert.match(r.headers['Content-Security-Policy'], /default-src 'none'/);
});

test('05: workspace commands remain dormant until the exact definition is approved', async t => {
  const h = host(); t.after(() => h.close());
  workspace(h.dir, { local: { type: 'stdio', command: process.execPath, args: [fixture] } });
  await h.ctx.agents.create({});
  assert.equal((await workspaceView(h)).servers[0].status, 'pending-approval'); assert.equal(h.tools.size, 0);
  await approve(h); await connected(h, 'local');
  workspace(h.dir, { local: { type: 'stdio', command: process.execPath, args: [fixture], env: { FIXTURE_KEY: 'changed' } } });
  await assert.rejects(h.ctx.tools.execute({ ...execution(), name: 'mcp__local__inspect', arguments: {} }), /changed/);
  await until(() => !h.tools.has('mcp__local__inspect'));
});

test('06: retargeting a workspace URL invalidates approval and never forwards stored OAuth', async t => {
  const a = await fixtureServer(), b = await fixtureServer(); t.after(() => Promise.all([a.close(), b.close()]));
  const h = host(); t.after(() => h.close()); workspace(h.dir, { remote: { url: a.url, authMode: 'oauth' } });
  await h.ctx.agents.create({}); await approve(h); await connected(h, 'remote');
  workspace(h.dir, { remote: { url: b.url, authMode: 'oauth' } });
  await until(() => !h.tools.has('mcp__remote__inspect'));
  assert.equal(b.requests.length, 0);
  assert.equal((await workspaceView(h)).servers[0].status, 'pending-approval');
  await approve(h); await connected(h, 'remote');
  assert.ok(b.requests.every(r => !r.headers.authorization));
});

test('07: editing a disabled server preserves disabled state and registers no tools', async t => {
  const f = await fixtureServer(); t.after(() => f.close()); const h = host(); t.after(() => h.close());
  const s = await add(h, { name: 'disabled', url: f.url, authMode: 'static' }); await connected(h, 'disabled');
  await h.api('POST', `/api/servers/${s.id}/enabled`, { enabled: false });
  const r = await h.api('PUT', `/api/servers/${s.id}`, { name: 'disabled', url: f.url, authMode: 'static' });
  assert.equal(r.status, 200, r.body); assert.equal(r.json().server.enabled, false); assert.equal(h.tools.size, 0);
});

test('08: disable cancels delayed initialization and prevents late registrations', async t => {
  let started = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixtureServer(async (_req, _res, body) => { if (body.method === 'initialize') { started = true; await gate; } });
  t.after(() => { release(); return f.close(); }); const h = host(); t.after(() => h.close());
  const s = await add(h, { name: 'race', url: f.url, authMode: 'static' }); await until(() => started);
  const r = await h.api('POST', `/api/servers/${s.id}/enabled`, { enabled: false });
  assert.equal(r.status, 200); release(); await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(h.tools.size, 0);
});

test('09: no-auth and custom-header-only HTTP endpoints connect', async t => {
  const f = await fixtureServer(); t.after(() => f.close()); const h = host(); t.after(() => h.close());
  await add(h, { name: 'public', url: f.url, authMode: 'static' }); await connected(h, 'public');
  await add(h, { name: 'custom', url: f.url, authMode: 'static', headers: { 'X-Fixture-Key': 'fixture' } }); await connected(h, 'custom');
  assert.ok(f.requests.some(r => r.headers['x-fixture-key'] === 'fixture'));
});

test('10: structured results survive execution and tools use exclusive scheduling', async t => {
  const f = await fixtureServer(); t.after(() => f.close()); const h = host(); t.after(() => h.close());
  await add(h, { name: 'structured', url: f.url, authMode: 'static' }); const tool = await connected(h, 'structured');
  const value = await tool.execute({}, execution()); assert.deepEqual(value.structuredContent, { amount: 42 });
  assert.equal(tool.isConcurrencySafe({}), false); assert.match(JSON.stringify(tool.output.render({}, value)), /42/);
});

test('11: execution abort cancels an actual pending HTTP tool call', async t => {
  let started = false, closed = false;
  const f = await fixtureServer((_req, res, body) => { if (body.method === 'tools/call') { started = true; res.on('close', () => { closed = true; }); return true; } });
  t.after(() => f.close()); const h = host(); t.after(() => h.close());
  await add(h, { name: 'cancel', url: f.url, authMode: 'static' }); const tool = await connected(h, 'cancel');
  const abort = new AbortController(); const call = tool.execute({}, execution(abort.signal));
  const rejected = assert.rejects(call, /cancel/i); await until(() => started); abort.abort(); await rejected;
  await until(() => f.requests.some(r => r.body.method === 'notifications/cancelled'));
  await until(() => closed); assert.ok(h.tools.has('mcp__cancel__inspect'));
});

test('12: real stdio exit clears stale tools and reconnects with a bounded retry', async t => {
  const h = host({ config: { reconnectMaxAttempts: 1, reconnectDelayMs: 100 } }); t.after(() => h.close());
  const script = join(h.dir, 'exit.mjs'), count = join(h.dir, 'count');
  writeFileSync(script, `import {appendFileSync,readFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(count)}, 'x'); await import(${JSON.stringify(new URL('./fixtures/mcp-stdio.mjs', import.meta.url).href)}); if(readFileSync(${JSON.stringify(count)},'utf8').length===1) setTimeout(()=>process.exit(0),150);`);
  await add(h, { name: 'restart', type: 'stdio', command: process.execPath, args: [script] }); await connected(h, 'restart');
  await until(() => !h.tools.has('mcp__restart__inspect')); await connected(h, 'restart');
  assert.equal(readFileSync(count, 'utf8'), 'xx');
});

test('13: DSH_HOME and profile identity control private state, with atomic private files', async t => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-home-test-'));
  const old = process.env.DSH_HOME; process.env.DSH_HOME = root; t.after(() => { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old; });
  let captured;
  const h = host({ config: { stateDir: undefined }, beforeApply(ctx) { const original = ctx.effect; ctx.effect = function(fn, label) { return original.call(this, fn, label); }; captured = ctx.root.baseUrl; } }); t.after(async () => { await h.close(); rmSync(root, { recursive: true, force: true }); });
  await add(h, { name: 'state', url: 'http://127.0.0.1:1/mcp', authMode: 'static' });
  const { createHash } = await import('node:crypto');
  const dir = join(root, 'mcp-manager-secure', createHash('sha256').update(captured).digest('hex').slice(0, 24));
  assert.ok(existsSync(join(dir, 'state.json'))); assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600);
});
