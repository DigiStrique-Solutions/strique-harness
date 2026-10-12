import fs from 'node:fs';
import path from 'node:path';
import { createHash, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function compareVersions(a, b) {
  if (![a, b].every(v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))) throw new Error('Invalid release version');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function verifyFeed(envelope, publicKey, target) {
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw new Error('Invalid signed update metadata');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Update signature is invalid');
  const value = JSON.parse(bytes);
  if (value.schemaVersion !== 1 || value.target !== target || typeof value.archive !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 4 * 1024 ** 3) throw new Error('Invalid update release descriptor');
  compareVersions(value.version, '0.0.0');
  if (new URL(value.archive).protocol !== 'https:') throw new Error('Update archive must use HTTPS');
  return value;
}
async function https(url) {
  for (let redirects = 0; redirects < 5; redirects++) {
    if (new URL(url).protocol !== 'https:') throw new Error('Downloads must use HTTPS');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('Redirect lacks a destination');
      url = new URL(next, url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Download failed: HTTP ${response.status}`); }
    return response;
  }
  throw new Error('Too many download redirects');
}
export async function readUpdate(config, target) {
  const response = await https(config.url);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 ** 2) throw new Error('Update metadata exceeds size limit');
    chunks.push(chunk);
  }
  return verifyFeed(JSON.parse(Buffer.concat(chunks)), config.publicKey, target);
}
export async function downloadUpdate(descriptor, destination) {
  const response = await https(descriptor.archive);
  const digest = createHash('sha256');
  let bytes = 0;
  const check = new Transform({ transform(chunk, encoding, done) {
    bytes += chunk.length;
    if (bytes > descriptor.bytes) return done(new Error('Update archive exceeds declared size'));
    digest.update(chunk); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), check, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (bytes !== descriptor.bytes || digest.digest('hex') !== descriptor.sha256) throw new Error('Update archive checksum or size mismatch');
}
export function verifyInventory(root) {
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json'), 'utf8'));
  if (!Array.isArray(entries)) throw new Error('Invalid release inventory');
  const allowed = new Set(['inventory.json']);
  for (const entry of entries) {
    if (typeof entry.file !== 'string' || path.isAbsolute(entry.file) || entry.file.split(/[\\/]/).some(p => p === '..' || p === '') || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid inventory entry');
    if (allowed.has(entry.file)) throw new Error('Duplicate inventory entry');
    allowed.add(entry.file);
    const file = path.join(root, entry.file);
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size !== entry.bytes || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256) throw new Error(`Release verification failed: ${entry.file}`);
  }
  for (const relative of fs.globSync(['**/*', '**/.*', '**/.*/**'], { cwd: root })) {
    const file = path.join(root, relative);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Release contains a symbolic link');
    if (fs.statSync(file).isFile() && !allowed.has(relative.split(path.sep).join('/'))) throw new Error(`Unlisted release file: ${relative}`);
  }
}
export function extractUpdate(archive, destination, expectedRoot) {
  const list = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 });
  if (list.error || list.status !== 0) throw new Error('Cannot inspect update archive; tar is required');
  for (const entry of list.stdout.trim().split('\n')) {
    if (entry.includes('\\') || entry.startsWith('/') || entry.includes(':') || entry.split('/').includes('..') || (entry !== expectedRoot && !entry.startsWith(`${expectedRoot}/`))) throw new Error('Unsafe or unexpected update archive path');
  }
  const kinds = spawnSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 });
  if (kinds.error || kinds.status !== 0 || kinds.stdout.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw new Error('Update archive may only contain ordinary files and directories');
  fs.mkdirSync(destination);
  const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Update extraction failed');
  const root = path.join(destination, expectedRoot);
  verifyInventory(root);
  return root;
}
