#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, sign, createPrivateKey } from 'node:crypto';

if (process.argv.includes('--help')) {
  console.log('node setup/standalone/publish-feed.mjs ARCHIVE HTTPS_ARCHIVE_URL ED25519_PRIVATE_KEY OUTPUT_JSON\nSigns metadata locally; does not upload or publish anything.'); process.exit(0);
}
const [archive, url, keyFile, output] = process.argv.slice(2);
if (!output || process.argv.length !== 6) throw new Error('Expected archive, HTTPS archive URL, signing key, and output JSON path');
if (new URL(url).protocol !== 'https:') throw new Error('Archive URL must use HTTPS');
const match = path.basename(archive).match(/^strique-(\d+\.\d+\.\d+)-(darwin-arm64|darwin-x64|win32-x64|linux-x64|linux-arm64)\.tar\.gz$/);
if (!match) throw new Error('Archive filename must be a standalone release archive');
const key = createPrivateKey(fs.readFileSync(keyFile));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 release-signing key');
const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, version: match[1], target: match[2], archive: url,
  bytes: fs.statSync(archive).size, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }));
fs.writeFileSync(output, JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') }, null, 2), { flag: 'wx' });
console.log(`Signed ${output}. Upload the archive first, then publish this metadata at the configured feed URL.`);
