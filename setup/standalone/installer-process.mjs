import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

export function runInstaller(command, args, { env = process.env, progressFile, timeoutMs = INSTALL_TIMEOUT_MS, pollMs = 30000, report = console.log } = {}) {
  const started = Date.now();
  let output = '', timedOut = false;
  const progress = () => {
    try { return fs.readFileSync(progressFile, 'utf8').trim(); } catch { return ''; }
  };
  const status = () => {
    let stage = 'waiting for installer payload';
    for (const line of progress().split('\n').reverse()) {
      try { stage = JSON.parse(line).stage; break; } catch { /* A concurrent append may be incomplete. */ }
    }
    report(`Installer test: ${Math.round((Date.now() - started) / 1000)}s elapsed; ${stage}`);
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = chunk => { output = (output + chunk).slice(-65536); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const heartbeat = setInterval(status, pollMs);
    const timer = setTimeout(() => {
      timedOut = true;
      status();
      // Kill the bootstrap and its extraction/install children before cleanup.
      if (process.platform === 'win32' && child.pid) {
        const killed = spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 });
        if (killed.status !== 0) child.kill('SIGKILL');
      } else child.kill('SIGKILL');
    }, timeoutMs);
    const cleanup = () => { clearInterval(heartbeat); clearTimeout(timer); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup(); status();
      if (timedOut || code !== 0) {
        const error = new Error(`${timedOut ? `Installer test exceeded ${timeoutMs / 1000}s` : `Installer exited with ${code ?? signal}`}\n${progress()}\n${output}`);
        error.code = timedOut ? 'ETIMEDOUT' : 'INSTALLER_FAILED';
        reject(error);
      } else resolve();
    });
  });
}
