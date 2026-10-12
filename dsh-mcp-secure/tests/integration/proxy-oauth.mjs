// Exercise public-origin configuration and live row replacement through Loader.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { fixtureServer } from '../helpers.mjs';

assert.ok(process.env.DSH_HOME?.endsWith('/artifacts/release-home'), 'Use the isolated release home');
const mod = path => import(pathToFileURL(resolve('../deepseek-harness', path)).href);
const { runProfile } = await mod('apps/cli/src/profile-boot.ts');
const { createLaunchEnvironmentSnapshot } = await mod('packages/util/launch-environment/src/index.ts');
const { FiberState } = await mod('vendor/cordis/src/index.ts');
const patchPath = join(process.env.DSH_HOME, 'profiles/web/cordis.patch.yml');
const originalPatch = readFileSync(patchPath, 'utf8');
let providerOrigin, app, id;
const fixture = await fixtureServer((req, res, body) => {
  const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); return true; };
  if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: providerOrigin + '/mcp', authorization_servers: [providerOrigin] });
  if (req.url.startsWith('/.well-known/')) return json({ issuer: providerOrigin, authorization_endpoint: providerOrigin + '/authorize', token_endpoint: providerOrigin + '/token', registration_endpoint: providerOrigin + '/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
  if (req.url === '/register') throw new Error('Registered clients must never use DCR');
  if (req.url === '/token') return json({ access_token: 'synthetic-proxy-token', token_type: 'Bearer' });
  if (req.url === '/mcp' && req.headers.authorization !== 'Bearer synthetic-proxy-token') {
    res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${providerOrigin}/.well-known/oauth-protected-resource"` }); res.end(); return true;
  }
});
providerOrigin = new URL(fixture.url).origin;
async function until(check) {
  const end = Date.now() + 15000;
  while (!await check()) { assert.ok(Date.now() < end, 'Live patch did not reach its expected state'); await new Promise(r => setTimeout(r, 100)); }
}
// Node fetch rewrites Host to the socket destination. Raw HTTP reproduces a
// TLS proxy forwarding a public Host to a loopback upstream.
function send(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, async res => {
      try {
        const parts = []; for await (const part of res) parts.push(part);
        resolve(new Response(Buffer.concat(parts), { status: res.statusCode, headers: res.headers }));
      } catch (error) { reject(error); }
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('HTTP test timed out')));
    req.end(options.body);
  });
}
try {
  app = await runProfile({ profile: 'web', patchFiles: [], args: ['--port', '0', '--no-open'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) });
  const ctx = app.ctx, base = `http://127.0.0.1:${ctx.webServer.port}`, external = 'https://harness.example';
  const login = async origin => {
    const url = new URL(ctx.connection.authenticatedUrl(origin));
    const response = await send(base + '/' + url.search, { headers: { host: url.host } });
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return cookie;
  };
  const localCookie = await login(base);
  const api = (method, path, body, headers = {}) => send(base + '/mcp-manager' + path, { method, headers: { cookie: localCookie, origin: base, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const server of (await (await api('GET', '/api/servers')).json()).servers) {
    if (server.name === 'proxy_oauth') await api('DELETE', `/api/servers/${server.id}`);
  }
  assert.equal((await api('GET', '/api/servers', undefined, { host: 'harness.example', origin: external, cookie: '' })).status, 403);
  const added = await api('POST', '/api/servers', { name: 'proxy_oauth', url: fixture.url, authMode: 'oauth' });
  assert.equal(added.status, 201); id = (await added.json()).server.id;
  const entry = realpathSync(join(process.env.DSH_HOME, 'profiles/web/node_modules/dsh-mcp-manager-secure/lib/index.js'));
  writeFileSync(patchPath, originalPatch.replace(/^\[\]\s*$/m, '') + '\n' + [
    { id: 'connection', config: { trustedHosts: ['harness.example'] } },
    { id: 'mcp-manager-secure', disabled: true },
    { insert: [{ id: 'mcp-manager-secure-proxy', name: entry, config: { publicOrigin: external, oauthClientIds: { [id]: 'fixture-owned-app' } } }] },
  ].map(row => '- ' + JSON.stringify(row)).join('\n') + '\n');
  await until(async () => (await api('GET', '/api/servers', undefined, { host: 'harness.example', origin: external, cookie: '' })).status === 401);
  const entries = [...ctx.loader.entries()].filter(e => e.options.id === 'mcp-manager-secure-proxy');
  assert.equal(entries.length, 1); assert.equal(entries[0].fiber.state, FiberState.ACTIVE);
  const publicCookie = await login(external), headers = { host: 'harness.example', origin: external, cookie: publicCookie };
  assert.equal((await api('GET', '/api/servers', undefined, { ...headers, origin: 'https://attacker.example' })).status, 403);
  const response = await api('POST', `/api/servers/${id}/auth`, {}, headers); assert.equal(response.status, 200);
  const authUrl = new URL((await response.json()).authorizeUrl);
  assert.equal(authUrl.searchParams.get('client_id'), 'fixture-owned-app');
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${external}/mcp-manager/callback/${id}`);
  const callback = `/callback/${id}?code=fixture-code&state=${authUrl.searchParams.get('state')}`;
  const landing = await api('GET', callback, undefined, { ...headers, cookie: '', origin: '', 'sec-fetch-site': 'cross-site' });
  assert.equal(landing.status, 200); assert.match(await landing.text(), /Continue authorization/);
  assert.equal(fixture.requests.filter(r => r.url === '/token').length, 0);
  const completed = await api('GET', callback, undefined, headers); assert.equal(completed.status, 200);
  const list = await (await api('GET', '/api/servers', undefined, headers)).json();
  assert.equal(list.servers.find(s => s.id === id).status, 'connected');
  assert.equal(fixture.requests.find(r => r.url === '/token').body.redirect_uri, `${external}/mcp-manager/callback/${id}`);
  assert.equal((await api('GET', callback, undefined, headers)).status, 400);
  await api('DELETE', `/api/servers/${id}`, undefined, headers); id = undefined;
  // Unload the replacement before re-enabling the original state writer.
  writeFileSync(patchPath, originalPatch.replace(/^\[\]\s*$/m, '') + '\n- id: mcp-manager-secure\n  disabled: true\n');
  await until(async () => (await api('GET', '/api/servers')).status === 404);
  writeFileSync(patchPath, originalPatch);
  await until(async () => (await api('GET', '/api/servers', undefined, { host: 'harness.example', origin: external, cookie: '' })).status === 403);
  await until(async () => (await api('GET', '/api/servers')).status === 200);
  console.log('PASS: real Loader live replacement, HTTPS callback, registered client, public authentication, cross-origin rejection and rollback.');
} finally {
  writeFileSync(patchPath, originalPatch);
  await app?.shutdown.shutdown(0);
  await fixture.close();
}
