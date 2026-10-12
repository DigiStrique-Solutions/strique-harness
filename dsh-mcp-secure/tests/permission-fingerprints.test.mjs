import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { host, fixtureServer, until } from './helpers.mjs';

async function setup(t) {
  const tool = { name: 'inspect', title: 'Inspect', description: 'Original wording',
    inputSchema: { type: 'object', properties: { description: { type: 'string', description: 'Parameter wording' }, title: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { amount: { type: 'number', title: 'Amount' } } },
    annotations: { title: 'Inspect', readOnlyHint: true } };
  const fixture = await fixtureServer((_req, res, body) => {
    if (body.method !== 'tools/list') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [tool] } })); return true;
  });
  const h = host();
  t.after(async () => { await h.close(); await fixture.close(); });
  const added = await h.api('POST', '/api/servers', { name: 'wording', url: fixture.url, authMode: 'static' });
  assert.equal(added.status, 201);
  await until(() => h.tools.has('mcp__wording__inspect'));
  const id = added.json().server.id, path = `/api/permissions/${id}`;
  const view = async (owner = h) => (await owner.api('GET', path)).json().tools[0];
  const mode = async value => { const response = await h.api('PUT', path, { changes: [{ ...await view(), mode: value }] }); assert.equal(response.status, 200); };
  const reconnect = async () => { assert.equal((await h.api('POST', `/api/servers/${id}/connect`, {})).status, 200); };
  return { h, tool, fixture, id, path, view, mode, reconnect, state: () => JSON.parse(readFileSync(join(h.stateDir, 'state.json'), 'utf8')) };
}

test('permissions: wording changes preserve Allow, Ask and Block across reconnect and restart', async t => {
  const x = await setup(t);
  for (const mode of ['allow', 'ask', 'block']) {
    await x.mode(mode); const before = await x.view();
    x.tool.description += ' revised'; x.tool.title += ' revised'; x.tool.annotations.title += ' revised';
    x.tool.inputSchema.properties.description.description += ' revised'; x.tool.outputSchema.properties.amount.title += ' revised';
    await x.reconnect();
    const after = await x.view(); assert.equal(after.mode, mode); assert.equal(after.reviewRequired, false);
    assert.notEqual(after.fingerprint, before.fingerprint, 'stale management writes still require the current complete definition');
    assert.equal((await x.h.api('PUT', x.path, { changes: [{ ...before, mode: 'allow' }] })).status, 409);
    const restored = host({ state: x.state() });
    try { await until(() => restored.tools.has('mcp__wording__inspect')); assert.equal((await x.view(restored)).mode, mode); }
    finally { await restored.close(); }
    if (mode === 'allow') assert.deepEqual((await x.h.ctx.tools.execute({ name: 'mcp__wording__inspect', arguments: {} })).structuredContent, { amount: 42 });
    if (mode === 'block') await assert.rejects(x.h.ctx.tools.execute({ name: 'mcp__wording__inspect', arguments: {} }), /blocked/);
  }
});

test('permissions: nested schema documentation is ignored without changing named properties or literal data', async t => {
  const x = await setup(t);
  x.tool.inputSchema = { type: 'object', $defs: { description: { type: 'string', description: 'Old' } }, properties: {
    title: { anyOf: [{ type: 'string', title: 'Old' }, { type: 'null' }] },
    rows: { type: 'array', items: { type: 'object', properties: { description: { type: 'string', description: 'Old' } } } },
  }, additionalProperties: { type: 'string', description: 'Old' } };
  await x.reconnect(); await x.mode('allow');
  x.tool.inputSchema.$defs.description.description = 'New';
  x.tool.inputSchema.properties.title.anyOf[0].title = 'New';
  x.tool.inputSchema.properties.rows.items.properties.description.description = 'New';
  x.tool.inputSchema.additionalProperties.description = 'New';
  await x.reconnect(); assert.equal((await x.view()).mode, 'allow');
});

test('permissions: adding documentation to previously untitled tools preserves Allow', async t => {
  const x = await setup(t); delete x.tool.annotations; delete x.tool.title; delete x.tool.description;
  await x.reconnect(); await x.mode('allow');
  x.tool.annotations = { title: 'New title' }; x.tool.title = 'New title'; x.tool.description = 'New description';
  await x.reconnect(); assert.equal((await x.view()).mode, 'allow');
});

for (const [name, change] of Object.entries({
  'property named description': tool => { tool.inputSchema.properties.description.type = 'number'; },
  'property named title': tool => { delete tool.inputSchema.properties.title; },
  'literal const object': tool => { tool.inputSchema.properties.description = { const: { description: 'new' } }; },
  'literal enum object': tool => { tool.inputSchema.properties.description = { enum: [{ title: 'new' }] }; },
  'default object': tool => { tool.inputSchema.properties.description.default = { description: 'new' }; },
  'output schema': tool => { tool.outputSchema.properties.amount.type = 'string'; },
  'execution annotation': tool => { tool.annotations.readOnlyHint = false; },
})) test(`permissions: ${name} changes require review and explicit review clears the notice`, async t => {
  const x = await setup(t);
  if (name === 'literal const object') x.tool.inputSchema.properties.description = { const: { description: 'old' } };
  if (name === 'literal enum object') x.tool.inputSchema.properties.description = { enum: [{ title: 'old' }] };
  if (name === 'default object') x.tool.inputSchema.properties.description.default = { description: 'old' };
  await x.reconnect(); await x.mode('allow'); change(x.tool); await x.reconnect();
  const view = await x.view(); assert.equal(view.mode, 'ask'); assert.equal(view.reviewRequired, true);
  assert.match(view.reviewReason, /definition or server configuration changed/);
  assert.equal((await x.h.api('GET', '/api/servers')).json().servers[0].permissionReviewCount, 1);
  await assert.rejects(x.h.ctx.tools.execute({ name: 'mcp__wording__inspect', arguments: {} }), /requires approval/);
  const restored = host({ state: x.state() });
  try { await until(() => restored.tools.has('mcp__wording__inspect')); assert.equal((await x.view(restored)).reviewRequired, true); }
  finally { await restored.close(); }
  await x.mode('ask'); assert.equal((await x.view()).reviewRequired, false);
  assert.equal((await x.h.api('GET', '/api/servers')).json().servers[0].permissionReviewCount, 0);
});

test('permissions: legacy migration preserves exact matches and never resurrects a prior Allow', async t => {
  const x = await setup(t);
  for (const mode of ['allow', 'ask', 'block']) {
    await x.mode(mode);
    const state = x.state(); for (const record of Object.values(state.toolPermissions)) delete record.permissionFingerprint;
    const restored = host({ state });
    try {
      await until(() => restored.tools.has('mcp__wording__inspect')); assert.equal((await x.view(restored)).mode, mode);
      const migrated = JSON.parse(readFileSync(join(restored.stateDir, 'state.json'), 'utf8'));
      assert.ok(Object.values(migrated.toolPermissions).every(record => record.permissionFingerprint?.startsWith('v2:')));
    } finally { await restored.close(); }
  }
  await x.mode('allow'); const state = x.state();
  for (const record of Object.values(state.toolPermissions)) delete record.permissionFingerprint;
  x.tool.description = 'Changed before migration';
  const changed = host({ state });
  try { await until(() => changed.tools.has('mcp__wording__inspect')); const view = await x.view(changed); assert.equal(view.mode, 'ask'); assert.equal(view.reviewRequired, true); }
  finally { await changed.close(); }
});
