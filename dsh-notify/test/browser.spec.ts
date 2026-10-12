import type { test as PlaywrightTest, expect as PlaywrightExpect } from '@playwright/test';
import { readFileSync } from 'node:fs';

export function registerBrowserTests(test: typeof PlaywrightTest, expect: typeof PlaywrightExpect) {
test.use({ trace: 'off', video: 'off' });
test.setTimeout(60_000);

test('packed plugin loads in Harness and its English settings work', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(15_000);
  const base = new URL(process.env.QA_TARGET_URL!).origin;
  const home = process.env.DSH_NOTIFY_TEST_HOME;
  if (!home) throw new Error('Set DSH_NOTIFY_TEST_HOME to the isolated verification home');
  const launchUrl = readFileSync(`${home}/launch-url`, 'utf8').trim();
  if (new URL(launchUrl).origin !== base) throw new Error('Verification URL must match the isolated origin');
  const login = await context.request.get(launchUrl);
  expect(login.ok()).toBeTruthy();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const w = window as any;
    w.__notifyEvents = [];
    w.Notification = class {
      static permission = 'granted';
      static requestPermission() { return Promise.resolve('granted'); }
      constructor(title: string, options: unknown) { w.__notifyEvents.push({ title, options }); }
    };
    w.__notifyNotes = [];
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = original.call(this);
      const start = node.start.bind(node);
      node.start = (when?: number) => { w.__notifyNotes.push({ type: node.type, frequency: node.frequency.value }); start(when); };
      return node;
    };
  });
  const expectedClient = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let servedCurrentClient = false;
  // Observe the packed plugin at its real Loader entry without adding production diagnostics.
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'script') return route.continue();
    const response = await route.fetch();
    let body = await response.text();
    if (body.includes(expectedClient)) servedCurrentClient = true;
    body = body.replace('exports.apply = (ctx) => createRuntime().apply(ctx);', 'exports.apply = (ctx) => { window.__notifyQA = ctx; return createRuntime().apply(ctx); };');
    await route.fulfill({ response, body });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__notifyQA))).toBeTruthy();
  expect(servedCurrentClient, "Harness must serve the current packed Client bytes").toBe(true);
  const notice = page.getByRole('dialog', { name: /^(Preview Notice|Internal Testing Notice)$/ });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) {
    await notice.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(notice).not.toBeVisible();
  }
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await page.addLocatorHandler(later, async () => { await later.click(); });
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(page.locator('[data-dsh-boot]')).toHaveCount(0);
  await expect(page.locator('style[data-plugin-css="dsh-notify/notify.css"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('Enable notifications & chimes', { exact: true })).toBeVisible();
  if (process.env.QA_SCENARIO === 'smoke') {
    expect(errors).toEqual([]);
    return;
  }
  await page.getByRole('button', { name: 'Play question chime', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__notifyNotes.length)).toBe(3);
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__notifyEvents.length)).toBe(1);
  await page.locator('input[type="range"]').fill('80');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dsh-notify/settings/v1')!).volume)).toBe(80);
  await page.screenshot({ path: testInfo.outputPath('notifications-settings.png') });
  await page.evaluate(() => {
    const w = window as any;
    w.__publishNotify = w.__notifyQA.uiSession.registerPendingInteraction(() => 10);
    w.__removeNotify = w.__publishNotify({ key: 'qa-approval', kind: 'approval', sessionId: 'qa-notify' }, async () => {});
  });
  await expect.poll(() => page.evaluate(() => (window as any).__notifyEvents.at(-1)?.options.body)).toContain('approval');
  for (const kind of ['question', 'plan-review']) {
    await page.evaluate(kind => {
      const w = window as any;
      w.__removeNotify();
      w.__removeNotify = w.__publishNotify({ key: `qa-${kind}`, kind, sessionId: 'qa-notify' }, async () => {});
    }, kind);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__notifyEvents.length)).toBe(4);
  expect(await page.evaluate(() => (window as any).__notifyNotes.length)).toBe(12);
  await page.evaluate(async () => {
    const w = window as any;
    w.__removeNotify();
    await w.__notifyQA.fiber.dispose();
  });
  await expect(page.locator('style[data-plugin-css="dsh-notify/notify.css"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('style[data-plugin-css="dsh-notify/notify.css"]')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-notify/settings/v1')!).volume)).toBe(80);
  expect(errors).toEqual([]);
});

}
