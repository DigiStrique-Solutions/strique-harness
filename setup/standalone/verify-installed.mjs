import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(process.argv[2]);
const data = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'strique-installed-check-'));
const node = path.join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const env = { ...process.env, STRIQUE_DATA_DIR: data,
  PATH: process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin' };
const child = spawn(node, [path.join(root, 'control.mjs'), 'start', '--no-open', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
child.stdout.on('data', () => {});
const exit = once(child, 'exit');
try {
  let owner;
  for (let count = 0; count < 600; count++) {
    if (child.exitCode !== null) throw new Error(`Installed application failed: ${stderr}`);
    const file = path.join(data, 'running/owner.json');
    if (fs.existsSync(file)) {
      owner = JSON.parse(fs.readFileSync(file));
      if (owner.url) break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!owner?.url) throw new Error(`Installed application did not become ready: ${stderr}`);
  let response = await fetch(owner.url, { redirect: 'manual' });
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (response.status === 302 || response.status === 303) {
    const location = response.headers.get('location'); await response.body.cancel();
    response = await fetch(new URL(location, owner.url), { headers: { cookie } });
  }
  if (response.status !== 200 || !(await response.text()).includes('Strique')) throw new Error('Installed Web interface did not respond');
  const stopped = spawnSync(node, [path.join(root, 'control.mjs'), 'stop'], { env, encoding: 'utf8', timeout: 10000 });
  if (stopped.status !== 0) throw new Error(`Installed application did not accept stop: ${stopped.stderr}`);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  await exit; clearTimeout(timer);
  const status = spawnSync(node, [path.join(root, 'control.mjs'), 'status'], { env, encoding: 'utf8' });
  if (status.status !== 0 || JSON.parse(status.stdout).running) throw new Error('Installed application retained an active process');
  console.log('Real installation, private home, browser response, and authenticated shutdown passed with system Node/npm absent from PATH.');
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exit; }
  fs.rmSync(data, { recursive: true, force: true });
}
