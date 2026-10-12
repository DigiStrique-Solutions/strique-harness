import { test, expect } from '@playwright/test';
test.use({ trace: 'off', video: 'off' });
test('real browser Allow once and Reject control actual MCP execution', async ({ page }, testInfo) => {
  const base = new URL(process.env.QA_TARGET_URL!).origin;
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Continue', exact: true }).click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {}); if (await later.isVisible()) await later.click();
  await page.getByRole('treeitem', { name: 'Ungrouped', exact: true }).click();
  await page.getByText('MCP permission browser test', { exact: true }).first().click();
  const status = () => page.request.get(base + '/permission-fixture/status').then(r => r.json());
  const initial = await status();
  const requestCall = () => page.request.post(base + '/permission-fixture/call', { data: {}, timeout: 25000 }).then(async r => { expect(r.status()).toBe(200); return r.json(); });
  const first = requestCall();
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await expect(page.getByText(/Allow mcp__approval_fixture__inspect from approval_fixture once/)).toBeVisible();
  expect((await status()).calls).toBe(initial.calls);
  await page.screenshot({ path: testInfo.outputPath('ask-before-mcp-call.png') });
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  const allowed = await first; expect(allowed.isError).toBe(false); expect(allowed.calls).toBe(initial.calls + 1);
  const second = requestCall();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const rejected = await second; expect(rejected.isError).toBe(true); expect(rejected.calls).toBe(initial.calls + 1);
  const permission = await (await page.request.get(base + `/mcp-manager/api/permissions/${initial.serverId}`)).json();
  expect(permission.tools[0].mode).toBe('ask');
  for (const [mode, expectedError] of [['block', true], ['allow', false]] as const) {
    expect((await page.request.put(base + `/mcp-manager/api/permissions/${initial.serverId}`, { data: { changes: [{ ...permission.tools[0], mode }] } })).status()).toBe(200);
    const result = await requestCall(); expect(result.isError).toBe(expectedError);
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  }
  expect((await status()).calls).toBe(initial.calls + 2);
});
