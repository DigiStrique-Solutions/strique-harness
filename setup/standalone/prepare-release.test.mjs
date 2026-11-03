import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url));
const files = [
  'strique-1.0.0-win32-x64.exe', 'strique-1.0.0-win32-x64.tar.gz',
  'strique-1.0.0-darwin-arm64.pkg', 'strique-1.0.0-darwin-arm64.tar.gz',
  'strique-1.0.0-darwin-x64.pkg', 'strique-1.0.0-darwin-x64.tar.gz',
  'strique-1.0.0-linux-x64.tar.gz', 'strique-1.0.0-linux-arm64.tar.gz',
];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strique-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of files) fs.writeFileSync(path.join(dir, name), `payload for ${name}`);
  return dir;
}
function prepare(dir, version = '1.0.0') {
  return spawnSync(process.execPath, [script, version, dir], { encoding: 'utf8' });
}
test('complete release produces independently verifiable checksums and can be prepared again', t => {
  const dir = fixture(t);
  assert.equal(prepare(dir).status, 0);
  const expected = [...files].sort().map(name => `${createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')}  ${name}\n`).join('');
  assert.equal(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8'), expected);
  assert.equal(prepare(dir).status, 0);
});
test('missing architecture prevents release preparation', t => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, 'strique-1.0.0-linux-arm64.tar.gz'));
  assert.notEqual(prepare(dir).status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'SHA256SUMS.txt')), false);
});
test('empty installer prevents release preparation', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, files[0]), '');
  assert.match(prepare(dir).stderr, /nonempty regular file/);
});
test('mixed versions prevent release preparation', t => {
  const dir = fixture(t);
  fs.renameSync(path.join(dir, files[0]), path.join(dir, files[0].replace('1.0.0', '0.9.0')));
  assert.notEqual(prepare(dir).status, 0);
});
test('invalid product versions are rejected', t => {
  assert.match(prepare(fixture(t), '../1.0.0').stderr, /Usage:/);
});
