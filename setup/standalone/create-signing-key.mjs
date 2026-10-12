import fs from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
const [privateFile, publicFile] = process.argv.slice(2);
if (!privateFile || !publicFile) throw new Error('Usage: node create-signing-key.mjs PRIVATE_FILE PUBLIC_FILE. Keep the private file outside the source/export folders.');
if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) throw new Error('Key output already exists; existing release keys will not be overwritten');
const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
fs.writeFileSync(privateFile, keys.privateKey, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(publicFile, keys.publicKey, { flag: 'wx', mode: 0o644 });
console.log('Release signing key and public verification key created. Keep the private key backed up and outside packages.');
