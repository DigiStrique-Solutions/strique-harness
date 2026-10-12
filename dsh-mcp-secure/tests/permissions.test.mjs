import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { host, fixtureServer, until } from './helpers.mjs';

async function setup(t, options = {}) {
  let description = 'Inspect fixture', extra = false;
  const f = await fixtureServer((_req, res, body) => {
    if (body.method !== 'tools/list') return;
    const tools = [{ name: 'inspect', description, inputSchema: { type: 'object', properties: extra ? { changed: { type: 'boolean' } } : {} }, annotations: { readOnlyHint: true } }];
    if (extra) tools.push({ name: 'new_tool', inputSchema: { type: 'object' } });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } })); return true;
  });
  const h = host(options);
  t.after(async () => { await h.close(); await f.close(); });
  const response = await h.api('POST', '/api/servers', { name: 'policy', url: f.url, authMode: 'static' }); assert.equal(response.status, 201);
  const server = response.json().server, path = `/api/permissions/${server.id}`;
  await until(() => h.tools.has('mcp__policy__inspect'));
  return { h, f, server, path,
    async view() { return (await h.api('GET', path)).json(); },
    async mode(mode) { const view = (await h.api('GET', path)).json(); const r = await h.api('PUT', path, { changes: [{ ...view.tools[0], mode }] }); assert.equal(r.status, 200, r.body); },
    call(input = {}) { return h.ctx.tools.execute({ name: 'mcp__policy__inspect', arguments: {}, ...input }); },
    count() { return f.requests.filter(r => r.body.method === 'tools/call').length; },
    change() { description = 'Changed behavior'; extra = true; },
  };
}

test('permissions: new read-only tools require approval, explicit Allow executes, Block never sends', async t => {
  const x = await setup(t);
  assert.equal((await x.view()).tools[0].mode, 'ask');
  await assert.rejects(x.call(), /requires approval/); assert.equal(x.count(), 0);
  await x.mode('allow'); assert.deepEqual((await x.call()).structuredContent, { amount: 42 });
  await x.mode('block'); await assert.rejects(x.call(), /blocked/); assert.equal(x.count(), 1);
});

test('permissions: approval is per execution, and reject/cancel/missing answerer fail closed', async t => {
  const prompts = []; let outcome = 'allowed-once';
  const x = await setup(t, { beforeApply(ctx) { ctx.get = name => name === 'approval' ? { async request(req) { prompts.push(req); return outcome; } } : undefined; } });
  const agent = {};
  await x.call({ agent }); await x.call({ agent }); assert.equal(prompts.length, 2); assert.equal(x.count(), 2);
  for (outcome of ['rejected', 'cancelled', 'unavailable']) await assert.rejects(x.call({ agent }), /rejected, cancelled, or unavailable/);
  assert.equal(x.count(), 2);
  await x.mode('allow'); await x.call({ agent }); assert.equal(prompts.length, 5);
});

test('permissions: changing permission while an approval is pending invalidates the grant', async t => {
  let answer, asked;
  const x = await setup(t, { beforeApply(ctx) { ctx.get = name => name === 'approval' ? { request(req) { asked = req; return new Promise(resolve => { answer = resolve; }); } } : undefined; } });
  const pending = x.call({ agent: {}, callId: 'child', rootCallId: 'visible-parent' });
  await until(() => !!answer); assert.equal(asked.callId, 'visible-parent');
  await x.mode('allow'); answer('allowed-once');
  await assert.rejects(pending, /changed while/); assert.equal(x.count(), 0);
  await x.call(); assert.equal(x.count(), 1);
});

test('permissions: an aborted call cannot use a late affirmative answer', async t => {
  let answer;
  const x = await setup(t, { beforeApply(ctx) { ctx.get = name => name === 'approval' ? { request() { return new Promise(resolve => { answer = resolve; }); } } : undefined; } });
  const controller = new AbortController(), pending = x.call({ agent: {}, signal: controller.signal });
  await until(() => !!answer); controller.abort(); answer('allowed-once');
  await assert.rejects(pending, /cancelled/); assert.equal(x.count(), 0);
});

test('permissions: validation is authenticated, atomic, bounded and rejects stale definitions', async t => {
  const x = await setup(t), tool = (await x.view()).tools[0];
  assert.equal((await x.h.api('GET', x.path, undefined, { cookie: '' })).status, 401);
  assert.equal((await x.h.api('PUT', x.path, { changes: [{ ...tool, mode: 'allow' }] }, { origin: 'https://evil.example' })).status, 403);
  for (const changes of [[], [{ ...tool, mode: 'invalid' }], [{ ...tool, mode: 'allow' }, { ...tool, mode: 'block' }]]) assert.equal((await x.h.api('PUT', x.path, { changes })).status, 400);
  assert.equal((await x.h.api('PUT', x.path, { changes: [{ ...tool, mode: 'allow' }, { name: 'missing', mode: 'allow' }] })).status, 409);
  assert.equal((await x.view()).tools[0].mode, 'ask');
  assert.equal((await x.h.api('PUT', x.path, { changes: [{ ...tool, fingerprint: 'stale', mode: 'allow' }] })).status, 409);
  assert.equal(x.count(), 0);
});

test('permissions: reconnect and disable/enable preserve grants; changed and newly discovered tools ask again', async t => {
  const x = await setup(t); await x.mode('allow');
  await x.h.api('POST', `/api/servers/${x.server.id}/connect`, {});
  assert.equal((await x.view()).tools[0].mode, 'allow');
  await x.h.api('POST', `/api/servers/${x.server.id}/enabled`, { enabled: false });
  await x.h.api('POST', `/api/servers/${x.server.id}/enabled`, { enabled: true });
  assert.equal((await x.view()).tools[0].mode, 'allow');
  const old = (await x.view()).tools[0]; x.change();
  await x.h.api('POST', `/api/servers/${x.server.id}/connect`, {});
  const current = await x.view(); assert.equal(current.tools.length, 2); assert.ok(current.tools.every(t => t.mode === 'ask'));
  assert.notEqual(current.tools[0].fingerprint, old.fingerprint);
  await assert.rejects(x.call(), /requires approval/);
});

test('permissions: changing endpoint invalidates grants before the new endpoint can execute', async t => {
  const x = await setup(t), other = await fixtureServer(); t.after(() => other.close()); await x.mode('allow');
  const response = await x.h.api('PUT', `/api/servers/${x.server.id}`, { name: 'policy', url: other.url, authMode: 'static' }); assert.equal(response.status, 200);
  assert.equal((await x.view()).tools[0].mode, 'ask'); await assert.rejects(x.call(), /requires approval/);
  assert.equal(other.requests.filter(r => r.body.method === 'tools/call').length, 0);
});

test('permissions: direct definition execution cannot bypass the registry and permissions persist across Host instances', async t => {
  const x = await setup(t); await x.mode('allow');
  await assert.rejects(x.h.tools.get('mcp__policy__inspect').execute({}, { signal: new AbortController().signal, name: 'mcp__policy__inspect', token: Symbol() }), /not been approved/);
  assert.equal(x.count(), 0);
  const state = JSON.parse(readFileSync(join(x.h.stateDir, 'state.json'), 'utf8'));
  const restored = host({ state }); t.after(() => restored.close()); await until(() => restored.tools.has('mcp__policy__inspect'));
  assert.equal((await restored.api('GET', x.path)).json().tools[0].mode, 'allow');
  await restored.ctx.tools.execute({ name: 'mcp__policy__inspect', arguments: {} }); assert.equal(x.count(), 1);
  await restored.api('DELETE', `/api/servers/${x.server.id}`);
  assert.deepEqual(JSON.parse(readFileSync(join(restored.stateDir, 'state.json'), 'utf8')).toolPermissions, {});
});
