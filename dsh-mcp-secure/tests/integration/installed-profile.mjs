// Boot the actual installed profile, including the published package-name row.
// Run separately for installed, removed, and restored with an isolated DSH_HOME.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureServer, until } from '../helpers.mjs';

const mode = process.argv[2];
assert.ok(['installed', 'removed', 'restored'].includes(mode));
assert.ok(process.env.DSH_HOME?.endsWith('/artifacts/release-home'), 'Use only the release-test home');
const harness = resolve(process.env.HARNESS_PATH || '../deepseek-harness');
const mod = path => import(pathToFileURL(join(harness, path)).href);
const { runProfile } = await mod('apps/cli/src/profile-boot.ts');
const { createLaunchEnvironmentSnapshot } = await mod('packages/util/launch-environment/src/index.ts');
const { FiberState } = await mod('vendor/cordis/src/index.ts');
const fixture = await fixtureServer();
let app;
try {
  app = await runProfile({ profile: 'web', patchFiles: [], args: ['--port', '0', '--no-open'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) });
  const ctx = app.ctx, base = `http://127.0.0.1:${ctx.webServer.port}`;
  const entries = [...ctx.loader.entries()].filter(e => e.options.name === 'dsh-mcp-manager-secure');
  assert.equal(entries.length, mode === 'removed' ? 0 : 1);
  if (entries.length) assert.equal(entries[0].fiber.state, FiberState.ACTIVE);
  const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' });
  const cookie = launch.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const api = (method, path, body) => fetch(base + '/mcp-manager/api' + path, { method, headers: { cookie, origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await fetch(base, { headers: { cookie } })).status, 200);
  if (mode === 'removed') {
    assert.equal((await api('GET', '/servers')).status, 404);
    assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('mcp__')).length, 0);
  } else {
    const installed = join(process.env.DSH_HOME, 'profiles/web/node_modules/dsh-mcp-manager-secure');
    for (const file of ['index.js', 'client.js', 'index.d.ts']) assert.deepEqual(readFileSync(join(installed, 'lib', file)), readFileSync(new URL('../../lib/' + file, import.meta.url)));
    assert.equal((await fetch(base + '/mcp-manager/api/servers')).status, 401);
    if (mode === 'installed') {
      const existing = (await (await api('GET', '/servers')).json()).servers;
      for (const server of existing) if (server.name === 'release_fixture') await api('DELETE', `/servers/${server.id}`);
      const response = await api('POST', '/servers', { name: 'release_fixture', url: fixture.url, authMode: 'static' });
      assert.equal(response.status, 201); const server = (await response.json()).server;
      await until(() => ctx.tools.schemas().some(tool => tool.name === 'mcp__release_fixture__inspect'));
      const idForPermission = mode === 'installed' ? server.id : id;
      const permission = await (await api('GET', `/permissions/${idForPermission}`)).json();
      assert.ok(permission.tools.every(t => t.mode === 'ask'));
      assert.equal((await api('PUT', `/permissions/${idForPermission}`, { changes: permission.tools.map(t => ({ ...t, mode: 'allow' })) })).status, 200);
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: 'packed-call', name: 'mcp__release_fixture__inspect', arguments: {} });
      assert.equal(result.isError, false, JSON.stringify(result)); assert.deepEqual(result.value.structuredContent, { amount: 42 });
      assert.equal((await api('POST', `/servers/${server.id}/enabled`, { enabled: false })).status, 200);
    } else {
      const servers = (await (await api('GET', '/servers')).json()).servers;
      assert.equal(servers.length, 1); assert.equal(servers[0].name, 'release_fixture'); assert.equal(servers[0].status, 'disabled');
      assert.equal(fixture.requests.length, 0);
      const id = servers[0].id;
      assert.equal((await api('PUT', `/servers/${id}`, { name: 'release_fixture', url: fixture.url, authMode: 'static' })).status, 200);
      assert.equal((await api('POST', `/servers/${id}/enabled`, { enabled: true })).status, 200);
      await until(() => ctx.tools.schemas().some(tool => tool.name === 'mcp__release_fixture__inspect'));
      const idForPermission = mode === 'installed' ? server.id : id;
      const permission = await (await api('GET', `/permissions/${idForPermission}`)).json();
      assert.ok(permission.tools.every(t => t.mode === 'ask'));
      assert.equal((await api('PUT', `/permissions/${idForPermission}`, { changes: permission.tools.map(t => ({ ...t, mode: 'allow' })) })).status, 200);
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: 'restored-call', name: 'mcp__release_fixture__inspect', arguments: {} });
      assert.equal(result.isError, false, JSON.stringify(result)); assert.deepEqual(result.value.structuredContent, { amount: 42 });
      await api('POST', `/servers/${id}/enabled`, { enabled: false });
    }
  }
  await app.shutdown.shutdown(0); app = null;
  const stateRoot = join(process.env.DSH_HOME, 'mcp-manager-secure');
  if (existsSync(stateRoot)) for (const dir of readdirSync(stateRoot)) assert.ok(!existsSync(join(stateRoot, dir, 'writer.lock')));
  console.log(`PASS: packed profile ${mode}; real Loader, authenticated HTTP, shell, tools and shutdown verified.`);
} finally {
  await app?.shutdown.shutdown(0);
  await fixture.close();
}
