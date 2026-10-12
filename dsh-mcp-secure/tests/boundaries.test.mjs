import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { host, fixtureServer, until } from './helpers.mjs';
import { apply } from '../lib/index.js';

test('Boundary: oversized bodies, unsafe URLs, malformed args and headers fail before connection', async t => {
  const h = host({ config: { maxBodyBytes: 1024 } }); t.after(() => h.close());
  for (const body of [
    { name: 'big', url: 'http://127.0.0.1:1/mcp', headers: { Huge: 'x'.repeat(1200) } },
    ...['http://remote.example/mcp', 'file:///etc/passwd', 'https://user:password@example.com/mcp', 'https://example.com/mcp#fragment'].map(url => ({ name: 'bad', url })),
    { name: 'args', type: 'stdio', command: process.execPath, args: [123] },
    { name: 'headers', url: 'https://example.com/mcp', headers: { Authorization: 'a\r\nb' } },
    { name: 'headers', url: 'https://example.com/mcp', headers: 'not-an-object' },
  ]) assert.equal((await h.api('POST', '/api/servers', body)).status, 400);
  assert.deepEqual((await h.api('GET', '/api/servers')).json().servers, []);
});

test('Boundary: oversized remote responses and repeated pagination cannot register tools', async t => {
  const large = await fixtureServer((_req, res, body) => { if (body.method === 'tools/list') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [], extra: 'x'.repeat(4000) } })); return true; } });
  const pages = await fixtureServer((_req, res, body) => { if (body.method === 'tools/list') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [], nextCursor: 'repeat' } })); return true; } });
  const h = host({ config: { maxResponseBytes: 2048 } }); t.after(async () => { await h.close(); await large.close(); await pages.close(); });
  for (const [name, url] of [['large', large.url], ['pages', pages.url]]) {
    const s = (await h.api('POST', '/api/servers', { name, url, authMode: 'static' })).json().server;
    await h.api('POST', `/api/servers/${s.id}/connect`);
  }
  assert.equal(h.tools.size, 0);
  assert.ok((await h.api('GET', '/api/servers')).json().servers.every(s => s.status === 'error'));
});

test('Boundary: symlinked workspace configs cannot be approved or overwritten', async t => {
  const h = host(), outside = mkdtempSync(join(tmpdir(), 'mcp-outside-')); t.after(async () => { await h.close(); rmSync(outside, { recursive: true, force: true }); });
  mkdirSync(join(h.dir, '.dsh/dshmm'), { recursive: true });
  const target = join(outside, 'keep.json'); writeFileSync(target, '{"keep":true}'); symlinkSync(target, join(h.dir, '.dsh/dshmm/mcp.json'));
  await h.ctx.agents.create({});
  assert.equal((await h.api('POST', '/api/workspaces/servers', { path: h.dir, name: 'escape', url: 'http://127.0.0.1:1/mcp' })).status, 400);
  assert.equal(readFileSync(target, 'utf8'), '{"keep":true}'); assert.equal(h.tools.size, 0);
});

test('Boundary: a second manager cannot write the same live state directory', async t => {
  const h = host(); t.after(() => h.close());
  assert.throws(() => apply(h.ctx, { stateDir: h.stateDir }), /already in use/);
  assert.ok(existsSync(join(h.stateDir, 'writer.lock')));
});

test('Boundary: secret markers retain existing values during an unrelated edit', async t => {
  const f = await fixtureServer(), h = host(); t.after(async () => { await h.close(); await f.close(); });
  const created = await h.api('POST', '/api/servers', { name: 'secret', url: f.url, authMode: 'static', headers: { 'X-Fixture': 'synthetic-secret' } });
  const s = created.json().server;
  const edited = await h.api('PUT', `/api/servers/${s.id}`, { ...s, name: 'renamed' });
  assert.equal(edited.status, 200, edited.body);
  await until(() => h.tools.has('mcp__renamed__inspect'));
  assert.ok(f.requests.some(r => r.headers['x-fixture'] === 'synthetic-secret'));
  assert.ok(!edited.body.includes('synthetic-secret'));
});

test('Boundary: deleting during initialization prevents late registrations and persisted resurrection', async t => {
  let started = false, release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixtureServer(async (_req, _res, body) => { if (body.method === 'initialize') { started = true; await gate; } });
  const h = host(); t.after(async () => { release(); await h.close(); await f.close(); });
  const s = (await h.api('POST', '/api/servers', { name: 'late', url: f.url, authMode: 'static' })).json().server;
  await until(() => started);
  assert.equal((await h.api('DELETE', `/api/servers/${s.id}`)).status, 200); release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.tools.size, 0); assert.deepEqual(JSON.parse(readFileSync(join(h.stateDir, 'state.json'), 'utf8')).servers, []);
});

test('Reliability: a quiet notification SSE stream survives the ordinary request timeout', async t => {
  let opened = false;
  const f = await fixtureServer((req, res) => { if (req.method === 'GET') { opened = true; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n'); return true; } });
  const h = host({ config: { requestTimeoutMs: 300 } }); t.after(async () => { await h.close(); await f.close(); });
  await h.api('POST', '/api/servers', { name: 'events', url: f.url, authMode: 'static' });
  await until(() => opened && h.tools.has('mcp__events__inspect'));
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.ok(h.tools.has('mcp__events__inspect'));
});
