#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json')));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'strique-smoke-'));
const home = path.join(temporary, 'home');
const profile = path.join(home, 'profiles/web');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: release.bundles } } }));
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), release.profilePatch || '[]\n');
const { NODE_OPTIONS, NODE_PATH, ...env } = process.env;
const node = path.join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const child = spawn(node, [path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: temporary, env: { ...env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let errors = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { errors += data; });
const exit = once(child, 'exit');
const deadline = Date.now() + 60000;
try {
  let url;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const logs = path.join(home, 'logs');
      const diagnostics = fs.existsSync(logs) ? fs.readdirSync(logs).filter(f => f.startsWith('startup-')).map(f => fs.readFileSync(path.join(logs, f), 'utf8')).join('\n') : '';
      throw new Error(`Packaged server exited during startup: ${errors.slice(-8000)}\n${diagnostics.slice(-16000)}`);
    }
    url = output.match(/https?:\/\/127\.0\.0\.1:\d+[^\s\x1b]*/)?.[0];
    if (url) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!url) throw new Error(`Packaged server did not announce a URL: ${errors.slice(-8000)}`);
  // Harness exchanges the one-time launch token for a cookie before redirecting.
  let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body.cancel();
    response = await fetch(new URL(location, url), { headers: { cookie }, signal: AbortSignal.timeout(15000) });
  }
  const body = await response.text();
  if (!response.ok || !body.includes('<html')) throw new Error(`Packaged Web UI did not serve HTML (HTTP ${response.status})`);
  for (const script of body.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const reference = script[1].replaceAll('&amp;', '&');
    const asset = await fetch(new URL(reference, url), { headers: { cookie }, signal: AbortSignal.timeout(15000) });
    if (!asset.ok) throw new Error(`Frontend JavaScript ${reference} is missing (HTTP ${asset.status})`);
    await asset.body.cancel();
  }
  if (/cannot resolve profile bundle|skipping profile bundle|ERR_MODULE_NOT_FOUND|Cannot find module|failed to import|Failed plugins/.test(errors)) throw new Error(`Packaged dependencies failed: ${errors.slice(-8000)}`);
  if (process.env.STRIQUE_PLAYWRIGHT_MODULE) {
    const playwright = await import(pathToFileURL(process.env.STRIQUE_PLAYWRIGHT_MODULE));
    const chromium = playwright.chromium || playwright.default?.chromium;
    if (!chromium) throw new Error('Playwright module does not expose Chromium');
    const browser = await chromium.launch({ headless: true, ...(process.env.STRIQUE_BROWSER_EXECUTABLE ? { executablePath: process.env.STRIQUE_BROWSER_EXECUTABLE } : {}) });
    try {
      const page = await browser.newPage();
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => document.title.includes('Strique'), { timeout: 30000 });
      await page.locator('[data-dsh-better-sidebar]').waitFor({ state: 'attached', timeout: 30000 });
      await page.waitForTimeout(1500);
      if (failures.length) throw new Error(`Browser errors: ${failures.join('; ')}`);
      if (process.env.STRIQUE_SCREENSHOT) await page.screenshot({ path: process.env.STRIQUE_SCREENSHOT, fullPage: true });
      console.log('Packaged browser rendered the Strique brand and Better Sidebar without page errors.');
    } finally { await browser.close(); }
  }
  console.log(`Packaged Web UI startup and frontend smoke passed for ${release.target}.`);
} finally {
  child.kill('SIGTERM');
  const finished = await Promise.race([exit.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
  if (!finished) { child.kill('SIGKILL'); await exit; }
  fs.rmSync(temporary, { recursive: true, force: true });
}
