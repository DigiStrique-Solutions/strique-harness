/** Exercise the real settings panel in an isolated, authenticated Harness profile. */
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test')
const home = process.env.DSH_CLI_QA_DIR
if (!home) throw new Error('Set DSH_CLI_QA_DIR to the isolated directory containing launch-url')
const launchUrl = (await readFile(join(home, 'launch-url'), 'utf8')).trim()
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } })
  const login = await context.request.get(launchUrl)
  assert.ok(login.ok(), 'Isolated Harness authentication succeeds')
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL(launchUrl).origin, { waitUntil: 'domcontentloaded' })
  for (const label of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name: label, exact: true })
    try { await button.waitFor({ state: 'visible', timeout: 4000 }); await button.click() } catch (error) {
      if (!error.message.includes('Timeout')) throw error
    }
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Local CLI', exact: true }).click()
  await page.getByText('Logged in using ChatGPT', { exact: true }).waitFor()
  await page.getByText('codex-cli 0.159.2', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: 'Default model', exact: true }).selectOption('gpt-6.1-sol')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByText('Settings saved.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Logged in using ChatGPT', { exact: true }).waitFor()
  await mkdir(join(home, 'artifacts'), { recursive: true })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('style[data-plugin="dsh-local-llm-cli"]').waitFor({ state: 'attached' })
  const cliNav = page.getByRole('button', { name: 'Local CLI', exact: true })
  if (!await cliNav.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await cliNav.click({ force: true })
  await page.waitForFunction(() => document.querySelector('.lc-main select')?.value === 'gpt-6.1-sol')
  assert.equal(await page.getByRole('combobox', { name: 'Default model', exact: true }).inputValue(), 'gpt-6.1-sol')
  // Reparent the verified panel solely to capture it without Harness's modal clipping.
  await page.evaluate(() => {
    const panel = document.querySelector('.lc-root')
    document.body.replaceChildren(panel)
    document.body.style.cssText = 'padding:24px;margin:0;height:auto;background:white'
    panel.style.width = '880px'; panel.style.maxWidth = '100%'
  })
  await page.setViewportSize({ width: 1440, height: 1800 })
  await page.locator('.lc-root').screenshot({ path: join(home, 'artifacts', 'settings.png') })
  await page.setViewportSize({ width: 560, height: 1800 })
  await page.locator('.lc-root').screenshot({ path: join(home, 'artifacts', 'settings-narrow.png') })
  assert.deepEqual(errors, [])
  console.log('Browser settings passed: activation, login status, model discovery, save, refresh, persistence, responsive layout, no page errors.')
} catch (error) {
  if (page) {
    console.error('Panel alerts:', await page.locator('.lc-main [role="alert"]').allTextContents())
    await mkdir(join(home, 'artifacts'), { recursive: true })
    await page.screenshot({ path: join(home, 'artifacts', 'failure.png') })
  }
  throw error
} finally { await browser.close() }
