const appBase = new URL(process.env.QA_TARGET_URL!).origin;
import { test, expect } from '@playwright/test';

// The key was supplied to the Host API separately. Never send it through a
// traced browser action or fetch it from private Host state in this scenario.
test.use({ trace: 'off', video: 'off' });
test('Firecrawl stays connected across secret-preserving edits and reconnect', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(appBase + '/', { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Continue', exact: true }).click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'MCP (Secure)', exact: true }).click();
  async function completeMutation(method: string, suffix: string, action: () => Promise<unknown>) {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix)),
      action(),
    ]);
    expect(response.ok()).toBe(true);
  }
  const initial = await (await page.request.get(appBase + '/mcp-manager/api/servers')).json();
  const serverPath = '/mcp-manager/api/servers/' + initial.servers.find(s => s.name === 'firecrawl').id;
  const row = page.getByRole('article').filter({ hasText: 'firecrawl' });
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('MCP endpoint URL')).toHaveValue('https://mcp.firecrawl.dev/v2/mcp');
  await expect(page.getByLabel('Secret headers key 1', { exact: true })).toHaveValue('Authorization');
  const secretInput = page.getByLabel('Secret headers value 1', { exact: true });
  await expect(secretInput).toHaveValue('');
  await expect(secretInput).toHaveAttribute('type', 'password');
  await completeMutation('PUT', serverPath, () => page.getByRole('button', { name: 'Save', exact: true }).click());
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  await completeMutation('POST', serverPath + '/enabled', () => row.getByRole('switch').click());
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  await completeMutation('POST', serverPath + '/enabled', () => row.getByRole('switch').click());
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  await completeMutation('POST', serverPath + '/connect', () => row.getByRole('button', { name: 'Reconnect', exact: true }).click());
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  const response = await page.request.get(appBase + '/mcp-manager/api/servers');
  const raw = await response.text();
  expect(/fc-[a-f0-9]{32}/i.test(raw)).toBe(false);
  expect(/fc-[a-f0-9]{32}/i.test(await page.content())).toBe(false);
  const server = JSON.parse(raw).servers.find(s => s.name === 'firecrawl');
  expect(server.status).toBe('connected');
  expect(server.toolCount).toBeGreaterThan(3);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('firecrawl-connected.png') });
});
