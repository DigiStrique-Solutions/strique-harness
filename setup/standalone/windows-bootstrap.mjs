import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { extractUpdate } from './updates.mjs';

// NSIS handles only short payload filenames. Node/tar handle the deep runtime tree.
const [archive, expectedRoot, expectedHash] = process.argv.slice(2);
const progressFile = process.env.STRIQUE_INSTALL_LOG || path.join(os.tmpdir(), 'Strique-install-progress.jsonl');
const report = stage => fs.appendFileSync(progressFile, JSON.stringify({ at: new Date().toISOString(), stage }) + '\n');
let temporary;
try {
  report('checking archive checksum');
  if (!/^strique-\d+\.\d+\.\d+-win32-x64$/.test(expectedRoot || '') || !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Invalid installer payload metadata');
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(archive), hash);
  if (hash.digest('hex') !== expectedHash) throw new Error('Installer payload checksum mismatch');
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'strique-install-'));
  report('extracting archive and verifying runtime files');
  const root = extractUpdate(archive, path.join(temporary, 'expanded'), expectedRoot);
  report('copying verified runtime and preparing user profile');
  const result = spawnSync(path.join(root, 'bin/node.exe'), [path.join(root, 'control.mjs'), 'install'], {
    stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Strique installation failed (${result.status ?? result.signal})`);
  report('runtime installed');
} catch (error) {
  console.error(error);
  fs.writeFileSync(path.join(os.tmpdir(), 'Strique-install-error.log'), String(error.stack || error));
  report(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) {
    report('cleaning extracted staging files');
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  report(process.exitCode ? 'installation failed' : 'installation complete');
}
