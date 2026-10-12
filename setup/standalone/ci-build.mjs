import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const version = process.env.RELEASE_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Set RELEASE_VERSION to X.Y.Z');
const target = `${process.platform}-${process.arch}`;
const args = ['setup/standalone/build.mjs', '--version', version, '--out', 'standalone-output'];
if (process.env.UPDATE_BASE_URL) {
  const base = new URL(process.env.UPDATE_BASE_URL.endsWith('/') ? process.env.UPDATE_BASE_URL : `${process.env.UPDATE_BASE_URL}/`);
  if (base.protocol !== 'https:') throw new Error('Update base must use HTTPS');
  if (!process.env.UPDATE_PUBLIC_KEY) throw new Error('Set UPDATE_PUBLIC_KEY together with UPDATE_BASE_URL');
  const key = path.join(os.tmpdir(), 'strique-update-public.pem');
  fs.writeFileSync(key, process.env.UPDATE_PUBLIC_KEY);
  args.push('--update-url', new URL(`${target}/latest.json`, base).href, '--public-key', key);
}
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
