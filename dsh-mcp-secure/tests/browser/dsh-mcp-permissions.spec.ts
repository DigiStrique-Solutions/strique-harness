import { test, expect } from '@playwright/test';
import { fixtureServer } from '/Users/poojan/Documents/ChatGPT/deepseek/dsh-mcp-manager-secure/tests/helpers.mjs';
test.use({ trace: 'off', video: 'off' });
const base = new URL(process.env.QA_TARGET_URL!).origin;
async function settings(page) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Continue', exact: true }).click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'MCP (Secure)', exact: true }).click();
}
test('permissions: individual modes, filtered bulk changes, persistence and stale review', async ({ page }, testInfo) => {
  let description = 'Synthetic read tool', properties = {}; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = await fixtureServer((_req, res, body) => {
    if (body.method !== 'tools/list') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [
      { name: 'inspect', description, inputSchema: { type: 'object', properties } },
      { name: 'write_fixture', description: 'Synthetic write tool', inputSchema: { type: 'object', properties: {} } },
    ] } })); return true;
  });
  let id;
  try {
    await settings(page);
    const existing = await (await page.request.get(base + '/mcp-manager/api/servers')).json();
    for (const s of existing.servers) if (s.name === 'browser_permissions') await page.request.delete(base + `/mcp-manager/api/servers/${s.id}`, { headers: { 'content-type': 'application/json' }, timeout: 5000 });
    const response = await page.request.post(base + '/mcp-manager/api/servers', { data: { name: 'browser_permissions', url: fixture.url, authMode: 'static' } });
    expect(response.status()).toBe(201); id = (await response.json()).server.id;
    const row = page.getByRole('article').filter({ hasText: 'browser_permissions' });
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Tool permissions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'browser_permissions tool permissions' })).toBeFocused();
    const inspect = page.getByLabel('Permission for inspect', { exact: true });
    const write = page.getByLabel('Permission for write_fixture', { exact: true });
    await expect(inspect).toHaveValue('ask'); await expect(write).toHaveValue('ask');
    const change = async (locator, mode) => {
      const [r] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/permissions/')), locator.selectOption(mode)]);
      expect(r.status()).toBe(200); await expect(page.getByText('Permissions saved.', { exact: true })).toBeVisible();
    };
    await change(inspect, 'allow'); await expect(inspect).toHaveValue('allow');
    await change(write, 'block'); await expect(write).toHaveValue('block');
    await page.getByLabel('Search tools', { exact: true }).fill('inspect');
    await change(page.getByRole('combobox', { name: 'Set all displayed tools', exact: true }), 'ask');
    await page.getByLabel('Search tools', { exact: true }).fill('');
    await expect(inspect).toHaveValue('ask'); await expect(write).toHaveValue('block');
    await page.getByLabel('Search tools', { exact: true }).fill('does-not-exist');
    await expect(page.getByText('No matching tools.', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Set all displayed tools', exact: true })).toBeDisabled();
    await page.getByLabel('Search tools', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Back to servers', exact: true }).click();
    const [reconnected] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/connect')), row.getByRole('button', { name: 'Reconnect', exact: true }).click()]); expect(reconnected.ok()).toBe(true);
    await row.getByRole('button', { name: 'Tool permissions', exact: true }).click(); await expect(write).toHaveValue('block');
    await change(inspect, 'allow');
    description = 'Updated description';
    expect((await page.request.post(base + `/mcp-manager/api/servers/${id}/connect`, { data: {} })).ok()).toBe(true);
    await page.getByRole('button', { name: 'Reload permissions', exact: true }).click();
    await expect(inspect).toHaveValue('allow');
    if (process.env.QA_PROJECT === 'dsh-mcp-fingerprint') {
      const result = await (await page.request.post(base + '/permission-fixture/call', { data: {} })).json();
      expect(result.isError).toBe(false);
    }
    await expect(page.getByText(/Permission review required:/)).toHaveCount(0);
    properties = { extra_input: { type: 'string' } };
    expect((await page.request.post(base + `/mcp-manager/api/servers/${id}/connect`, { data: {} })).ok()).toBe(true);
    const [stale] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/permissions/')), inspect.selectOption('block')]);
    expect(stale.status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Tool definition changed');
    await expect(inspect).toBeDisabled();
    await page.getByRole('button', { name: 'Reload permissions', exact: true }).click();
    await expect(inspect).toBeEnabled(); await expect(inspect).toHaveValue('ask'); await expect(write).toHaveValue('block');
    await expect(page.getByText(/Permission review required:/)).toContainText('definition or server configuration changed');
    if (process.env.QA_PROJECT === 'dsh-mcp-fingerprint') {
      const callsBefore = fixture.requests.filter(r => r.body.method === 'tools/call').length;
      const result = await (await page.request.post(base + '/permission-fixture/call', { data: {} })).json();
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('approval prompts are disabled');
      expect(JSON.stringify(result.content)).toContain('requires renewed approval');
      expect(fixture.requests.filter(r => r.body.method === 'tools/call')).toHaveLength(callsBefore);
    }
    await page.screenshot({ path: testInfo.outputPath('tool-permissions-desktop.png') });
    await page.getByRole('button', { name: 'Back to servers', exact: true }).click();
    await expect(row.getByText(/1 tool requires permission review/)).toBeVisible();
    await row.getByRole('button', { name: 'Tool permissions', exact: true }).click();
    await change(inspect, 'allow');
    await expect(page.getByText(/Permission review required:/)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { if (id) await page.request.delete(base + `/mcp-manager/api/servers/${id}`, { headers: { 'content-type': 'application/json' }, timeout: 3000 }).catch(() => {}); await fixture.close(); }
});
test('Firecrawl exposes discovered tools with safe default permissions', async ({ page }, testInfo) => {
  if (process.env.QA_PROJECT === 'dsh-local') await page.emulateMedia({ colorScheme: 'dark' });
  await settings(page);
  const row = page.getByRole('article').filter({ hasText: 'firecrawl' });
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Tool permissions', exact: true }).click();
  await expect(page.getByLabel('Permission for firecrawl_scrape', { exact: true })).toHaveValue('ask');
  const values = await page.locator('select[aria-label^="Permission for"]').evaluateAll(elements => elements.map(e => (e as HTMLSelectElement).value));
  expect(values.length).toBeGreaterThan(3); expect(values.every(v => v === 'ask')).toBe(true);
  expect(/fc-[a-f0-9]{32}/i.test(await page.content())).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('firecrawl-tool-permissions.png') });
});
