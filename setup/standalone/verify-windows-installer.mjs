import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyInventory } from './updates.mjs';

if (process.platform !== 'win32') throw new Error('Verify the Windows installer on Windows');
const [installer, bundle] = process.argv.slice(2).map(value => path.resolve(value));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'strique-exe-check-'));
// Exercise extraction beyond MAX_PATH, including long user-profile directory names.
const data = path.join(temporary, 'user-profile-with-a-long-directory-name', 'Strique');
const env = { ...process.env, STRIQUE_DATA_DIR: data, PATH: path.join(process.env.SystemRoot, 'System32'), NODE_OPTIONS: '', NODE_PATH: '' };
try {
  const installed = spawnSync(installer, ['/S'], { env, encoding: 'utf8', timeout: 300000 });
  if (installed.error) throw installed.error;
  assert.equal(installed.status, 0, `Installer failed: ${installed.stderr}`);
  const state = JSON.parse(fs.readFileSync(path.join(data, 'installation.json')));
  const root = path.join(data, 'releases', state.current);
  verifyInventory(root);
  assert.equal(fs.readFileSync(path.join(root, 'inventory.json'), 'utf8'), fs.readFileSync(path.join(bundle, 'inventory.json'), 'utf8'));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const checked = spawnSync(path.join(root, 'bin/node.exe'), [path.join(here, 'verify-installed.mjs'), root, data], {
    env, stdio: 'inherit', timeout: 180000,
  });
  if (checked.error) throw checked.error;
  assert.equal(checked.status, 0, 'Installed Windows application smoke failed');
  console.log('Actual Windows .exe installation, long-path extraction, inventory, and installed Web smoke passed.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
