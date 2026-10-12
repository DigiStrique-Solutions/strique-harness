import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

const root = path.resolve(process.argv[2]);
const ownsData = !process.argv[3];
const data = ownsData ? fs.mkdtempSync(path.join(os.tmpdir(), 'strique-installed-check-')) : path.resolve(process.argv[3]);
const node = path.join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const env = { ...process.env, STRIQUE_DATA_DIR: data,
  PATH: process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin' };
// Check the same default launch as the shortcut, with the old default occupied.
const blocker = net.createServer(socket => socket.end());
await new Promise((resolve, reject) => {
  blocker.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error));
  blocker.listen(3080, '127.0.0.1', resolve);
});
const child = spawn(node, [path.join(root, 'control.mjs'), 'start', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (new URL(owner.url).port === '3080') throw new Error('Default launch attempted to use the occupied port');
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
  if (blocker.listening) blocker.close();
  // The native installer verifier owns supplied homes and removes them after
  // this process exits. Windows cannot delete the Node executable running here.
  if (ownsData) fs.rmSync(data, { recursive: true, force: true });
}
