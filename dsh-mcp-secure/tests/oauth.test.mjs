import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { host, fixtureServer, until } from './helpers.mjs';

async function oauthFixture() {
  let base;
  const fixture = await fixtureServer((req, res, body) => {
    const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); return true; };
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: base + '/mcp', authorization_servers: [base] });
    if (req.url.startsWith('/.well-known/')) return json({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'] });
    if (req.url === '/register') return json({ ...body, client_id: 'fixture-client' });
    if (req.url === '/token') return json({ access_token: 'synthetic-oauth-secret', refresh_token: 'synthetic-refresh-secret', token_type: 'Bearer', expires_in: 3600 });
    if (req.url === '/mcp' && req.headers.authorization !== 'Bearer synthetic-oauth-secret') {
      res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); res.end(); return true;
    }
  });
  base = new URL(fixture.url).origin; return fixture;
}

test('OAuth: SDK discovery, PKCE, state, exchange, single-use callback and secret redaction', async t => {
  const fixture = await oauthFixture(); const h = host(); t.after(async () => { await h.close(); await fixture.close(); });
  const created = await h.api('POST', '/api/servers', { name: 'oauth', url: fixture.url, authMode: 'oauth' });
  const server = created.json().server;
  const response = await h.api('POST', `/api/servers/${server.id}/auth`);
  assert.equal(response.status, 200, response.body);
  const authorization = new URL(response.json().authorizeUrl);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorization.searchParams.get('code_challenge').length >= 43);
  const flow = authorization.searchParams.get('state'); assert.ok(flow.length >= 32);
  const invalid = await h.api('GET', `/callback/${server.id}?code=fixture-code&state=invalid`);
  assert.equal(invalid.status, 400); assert.equal(fixture.requests.filter(r => r.url === '/token').length, 0);
  const callback = `/callback/${server.id}?code=fixture-code&state=${flow}`;
  const landing = await h.api('GET', callback, undefined, { cookie: '', 'sec-fetch-site': 'cross-site' });
  assert.equal(landing.status, 200); assert.match(landing.body, /Continue authorization/);
  assert.equal(fixture.requests.filter(r => r.url === '/token').length, 0);
  const result = await h.api('GET', callback); assert.equal(result.status, 200, result.body);
  await until(() => h.tools.has('mcp__oauth__inspect'));
  assert.equal((await h.api('GET', callback)).status, 400);
  const exchange = fixture.requests.find(r => r.url === '/token');
  assert.equal(exchange.body.code, 'fixture-code'); assert.ok(exchange.body.code_verifier.length >= 43);
  assert.equal(exchange.body.resource, fixture.url);
  assert.ok(!(await h.api('GET', '/api/servers')).body.includes('synthetic-oauth-secret'));
  assert.ok(!JSON.stringify(h.logs).includes('synthetic-'));
});

test('OAuth: workspace retarget discards an actually issued token', async t => {
  const fixture = await oauthFixture(); const destination = await fixtureServer(); const h = host();
  t.after(async () => { await h.close(); await fixture.close(); await destination.close(); });
  const path = realpathSync(h.dir), file = join(path, '.dsh/dshmm/mcp.json'); mkdirSync(join(path, '.dsh/dshmm'), { recursive: true });
  const save = url => writeFileSync(file, JSON.stringify({ mcpServers: { oauth: { url, authMode: 'oauth' } } }));
  save(fixture.url); await h.ctx.agents.create({});
  const approve = async () => {
    const ws = (await h.api('GET', '/api/workspaces')).json().workspaces[0], server = ws.servers[0];
    assert.equal((await h.api('POST', '/api/workspaces/approve', { path, name: 'oauth', fingerprint: server.fingerprint })).status, 200); return server;
  };
  const server = await approve();
  const response = await h.api('POST', '/api/workspaces/auth', { path, name: 'oauth' });
  assert.equal(response.status, 200, response.body);
  const state = new URL(response.json().authorizeUrl).searchParams.get('state');
  const callback = await h.api('GET', `/callback/${server.id}?code=fixture-code&state=${state}`); assert.equal(callback.status, 200, callback.body);
  await until(() => h.tools.has('mcp__oauth__inspect'));
  assert.match(readFileSync(join(h.stateDir, 'state.json'), 'utf8'), /synthetic-oauth-secret/);
  save(destination.url);
  await until(() => !h.tools.has('mcp__oauth__inspect'));
  assert.equal(destination.requests.length, 0);
  assert.ok(!readFileSync(join(h.stateDir, 'state.json'), 'utf8').includes('synthetic-oauth-secret'));
  await approve(); await until(() => h.tools.has('mcp__oauth__inspect'));
  assert.ok(destination.requests.every(request => !request.headers.authorization));
});

test('OAuth: registration rejection is actionable without leaking the provider response or retrying in the background', async t => {
  let base;
  const fixture = await fixtureServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return true; };
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: base + '/mcp', authorization_servers: [base] });
    if (req.url.startsWith('/.well-known/')) return json(200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    if (req.url === '/register') return json(400, { error: 'invalid_client_metadata', error_description: 'Dynamic registration is not available for this client. synthetic-provider-secret <script>alert(1)</script>' });
    if (req.url === '/mcp') { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); res.end(); return true; }
  });
  base = new URL(fixture.url).origin;
  t.after(() => fixture.close());
  const h = host({ config: { reconnectMaxAttempts: 2, reconnectDelayMs: 100 } });
  t.after(() => h.close());
  const created = await h.api('POST', '/api/servers', { name: 'restricted', url: fixture.url, authMode: 'oauth' });
  const id = created.json().server.id;
  // Let any connection retry timers run: registering without an interactive
  // callback must never be a side effect of adding an OAuth endpoint.
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await h.api('GET', '/api/servers')).json().servers[0].status, 'needs-auth');
  assert.equal(fixture.requests.filter(r => r.url === '/register').length, 0);
  const response = await h.api('POST', `/api/servers/${id}/auth`);
  assert.equal(response.status, 400);
  assert.match(response.json().error, /provider rejected this client's registration/i);
  const listed = await h.api('GET', '/api/servers');
  assert.equal(listed.json().servers[0].error, response.json().error);
  assert.equal(fixture.requests.filter(r => r.url === '/register').length, 1);
  assert.ok(!(response.body + listed.body + JSON.stringify(h.logs)).includes('synthetic-provider-secret'));
  assert.ok(!(response.body + listed.body).includes('<script>'));
});

test('OAuth: configured public client skips registration and discards credentials from a different client', async t => {
  const fixture = await oauthFixture();
  const h = host({ config: { oauthClientIds: { registered: 'owned-app-id' } }, state: {
    servers: [{ id: 'registered', name: 'registered', type: 'http', url: fixture.url, authMode: 'oauth', enabled: true,
      oauth: { resource: fixture.url, configuredClientId: 'previous-app-id', redirect: 'http://127.0.0.1:3080/mcp-manager/callback/registered', client: { client_id: 'previous-app-id' }, tokens: { access_token: 'previous-app-secret', token_type: 'Bearer' } } }],
  } });
  t.after(async () => { await h.close(); await fixture.close(); });
  const response = await h.api('POST', '/api/servers/registered/auth');
  assert.equal(response.status, 200, response.body);
  const authorization = new URL(response.json().authorizeUrl);
  assert.equal(authorization.searchParams.get('client_id'), 'owned-app-id');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(fixture.requests.filter(r => r.url === '/register').length, 0);
  assert.ok(fixture.requests.every(r => r.headers.authorization !== 'Bearer previous-app-secret'));
  const callback = `/callback/registered?code=fixture-code&state=${authorization.searchParams.get('state')}`;
  assert.equal((await h.api('GET', callback)).status, 200);
  assert.equal(fixture.requests.find(r => r.url === '/token').body.client_id, 'owned-app-id');
  assert.equal(fixture.requests.filter(r => r.url === '/register').length, 0);
  assert.ok(!readFileSync(join(h.stateDir, 'state.json'), 'utf8').includes('previous-app-secret'));
});

test('OAuth: explicit HTTPS origin survives a proxy without trusting forwarded headers or bypassing authentication', async t => {
  const fixture = await oauthFixture();
  const h = host({ config: { publicOrigin: 'https://harness.example' }, beforeApply(ctx) {
    const original = ctx.connection.requestRejection;
    ctx.connection.requestRejection = req => req.headers.host === 'harness.example'
      ? req.headers.cookie === 'fixture-auth' ? undefined : 401 : original(req);
  } });
  t.after(async () => { await h.close(); await fixture.close(); });
  const headers = { host: 'harness.example', origin: 'https://harness.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' };
  const created = await h.api('POST', '/api/servers', { name: 'public', url: fixture.url, authMode: 'oauth' }, headers);
  const id = created.json().server.id;
  assert.equal((await h.api('POST', `/api/servers/${id}/auth`, undefined, { ...headers, cookie: '' })).status, 401);
  const response = await h.api('POST', `/api/servers/${id}/auth`, undefined, headers);
  assert.equal(response.status, 200, response.body);
  const authorization = new URL(response.json().authorizeUrl);
  const redirect = `https://harness.example/mcp-manager/callback/${id}`;
  assert.equal(authorization.searchParams.get('redirect_uri'), redirect);
  const callback = `/callback/${id}?code=fixture-code&state=${authorization.searchParams.get('state')}`;
  const landing = await h.api('GET', callback, undefined, { ...headers, cookie: '', origin: undefined, 'sec-fetch-site': 'cross-site' });
  assert.equal(landing.status, 200); assert.match(landing.body, /Continue authorization/);
  assert.equal(fixture.requests.filter(r => r.url === '/token').length, 0);
  assert.equal((await h.api('GET', callback)).status, 400);
  assert.equal((await h.api('GET', callback, undefined, { ...headers, origin: 'http://harness.example' })).status, 403);
  assert.equal((await h.api('GET', callback, undefined, headers)).status, 200);
  assert.equal(fixture.requests.find(r => r.url === '/token').body.redirect_uri, redirect);
  assert.equal((await h.api('GET', callback, undefined, headers)).status, 400);
});
