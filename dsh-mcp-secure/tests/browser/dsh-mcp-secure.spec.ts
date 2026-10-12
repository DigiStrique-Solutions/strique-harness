const appBase = new URL(process.env.QA_TARGET_URL!).origin;
import { test, expect } from '@playwright/test';
import { fixtureServer } from '/Users/poojan/Documents/ChatGPT/deepseek/dsh-mcp-manager-secure/tests/helpers.mjs';

// Harness keeps an SSE response open; tracing its body stalls Playwright teardown.
// Screenshots, assertions and the HTML report remain enabled for this scenario.
test.use({ trace: 'off', video: 'off' });

async function settings(page) {
  await page.goto(appBase + '/', { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Continue', exact: true }).click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'MCP (Secure)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MCP servers' })).toBeVisible();
  const existing = await (await page.request.get(appBase + '/mcp-manager/api/servers')).json();
  for (const server of existing.servers) if (server.name.startsWith('browser_')) await page.request.delete(`${appBase}/mcp-manager/api/servers/${server.id}`, { headers: { 'content-type': 'application/json' } });
}
async function add(page, name, url, oauth = false) {
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('MCP endpoint URL').fill(url);
  if (oauth) await page.getByLabel('Authentication', { exact: true }).selectOption('oauth');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test('secure MCP desktop: add, connect, secret-preserving edit, disable, reconnect and remove', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = await fixtureServer();
  try {
    await settings(page); await add(page, 'browser_fixture', fixture.url);
    let row = page.getByRole('article').filter({ hasText: 'browser_fixture' });
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const header = page.getByRole('group', { name: 'Secret headers', exact: true });
    await header.getByRole('button', { name: 'Add row' }).click();
    await page.getByLabel('Secret headers key 1', { exact: true }).fill('X-Fixture-Secret');
    await page.getByLabel('Secret headers value 1', { exact: true }).fill('synthetic-browser-secret');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    await row.getByRole('switch').click();
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Secret headers value 1', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Secret headers value 1', { exact: true })).toHaveAttribute('type', 'password');
    await page.getByLabel('Name', { exact: true }).fill('browser_renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    row = page.getByRole('article').filter({ hasText: 'browser_renamed' });
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
    await row.getByRole('switch').click();
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    expect(fixture.requests.some(r => r.headers['x-fixture-secret'] === 'synthetic-browser-secret')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('secure-mcp-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('secure-mcp-mobile.png') });
    const width = await page.locator('.mm_section').evaluate(element => element.getBoundingClientRect().width);
    if (width < 280) testInfo.annotations.push({ type: 'upstream limitation', description: 'At 390px the Harness settings shell clips its content. Mobile usability is not passed.' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await row.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    try { const servers = await (await page.request.get(appBase + '/mcp-manager/api/servers')).json();
    for (const server of servers.servers) if (server.name.startsWith('browser_')) await page.request.delete(`${appBase}/mcp-manager/api/servers/${server.id}`, { headers: { 'content-type': 'application/json' } });
    } catch {} finally { await fixture.close(); }
  }
});

test('real browser OAuth crosses sites and completes with the Strict Harness cookie', async ({ page }, testInfo) => {
  let base, provider;
  const fixture = await fixtureServer((req, res, body) => {
    const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); return true; };
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: base + '/mcp', authorization_servers: [base] });
    if (req.url.startsWith('/.well-known/')) return json({ issuer: base, authorization_endpoint: provider + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'] });
    if (req.url === '/register') return json({ ...body, client_id: 'browser-fixture' });
    if (req.url === '/token') return json({ access_token: 'synthetic-browser-oauth', token_type: 'Bearer', expires_in: 3600 });
    if (req.url.startsWith('/authorize')) {
      const query = new URL(req.url, provider).searchParams, callback = new URL(query.get('redirect_uri')); callback.searchParams.set('state', query.get('state')); callback.searchParams.set('code', 'fixture-code');
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<h1>Synthetic OAuth provider</h1><a href="${callback.href.replaceAll('&', '&amp;')}">Allow fixture</a>`); return true;
    }
    if (req.url === '/mcp' && req.headers.authorization !== 'Bearer synthetic-browser-oauth') { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); res.end(); return true; }
  });
  base = new URL(fixture.url).origin; provider = base.replace('127.0.0.1', 'localhost');
  try {
    await settings(page); await add(page, 'browser_oauth', fixture.url, true);
    const row = page.getByRole('article').filter({ hasText: 'browser_oauth' });
    const opened = page.waitForEvent('popup'); await row.getByRole('button', { name: 'Authenticate', exact: true }).click();
    const popup = await opened;
    await popup.getByRole('link', { name: 'Allow fixture' }).click();
    await expect(popup.getByRole('link', { name: 'Continue authorization' })).toBeVisible();
    expect(fixture.requests.filter(r => r.url === '/token')).toHaveLength(0);
    await popup.getByRole('link', { name: 'Continue authorization' }).click();
    await expect(popup.getByRole('heading', { name: 'Authorized' })).toBeVisible();
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    await popup.screenshot({ path: testInfo.outputPath('oauth-authorized.png') });
    expect(fixture.requests.filter(r => r.url === '/token')).toHaveLength(1);
    await popup.close();
  } finally {
    try { const servers = await (await page.request.get(appBase + '/mcp-manager/api/servers')).json();
    for (const server of servers.servers) if (server.name === 'browser_oauth') await page.request.delete(`${appBase}/mcp-manager/api/servers/${server.id}`, { headers: { 'content-type': 'application/json' } });
    } catch {} finally { await fixture.close(); }
  }
});

test('OAuth registration rejection explains provider compatibility without exposing its response', async ({ page }, testInfo) => {
  let base;
  const fixture = await fixtureServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return true; };
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: base + '/mcp', authorization_servers: [base] });
    if (req.url.startsWith('/.well-known/')) return json(200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    if (req.url === '/register') return json(400, { error: 'invalid_client_metadata', error_description: 'synthetic-provider-secret <script>alert(1)</script>' });
    if (req.url === '/mcp') { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); res.end(); return true; }
  });
  base = new URL(fixture.url).origin;
  try {
    await settings(page); await add(page, 'browser_rejected', fixture.url, true);
    const row = page.getByRole('article').filter({ hasText: 'browser_rejected' });
    await expect(row.getByText('Authentication required', { exact: true }).first()).toBeVisible();
    expect(fixture.requests.filter(r => r.url === '/register')).toHaveLength(0);
    const opened = page.waitForEvent('popup'); await row.getByRole('button', { name: 'Authenticate', exact: true }).click();
    const popup = await opened;
    await expect(row.getByText(/provider rejected this client's registration/)).toBeVisible();
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(await page.locator('body').innerText()).not.toContain('synthetic-provider-secret');
    await page.screenshot({ path: testInfo.outputPath('oauth-registration-rejected.png') });
  } finally {
    try { const servers = await (await page.request.get(appBase + '/mcp-manager/api/servers')).json();
    for (const server of servers.servers) if (server.name === 'browser_rejected') await page.request.delete(`${appBase}/mcp-manager/api/servers/${server.id}`, { headers: { 'content-type': 'application/json' } });
    } catch {} finally { await fixture.close(); }
  }
});
