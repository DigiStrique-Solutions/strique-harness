import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [version, directory] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !directory) {
  throw new Error('Usage: node setup/standalone/prepare-release.mjs X.Y.Z ARTIFACT_DIRECTORY');
}
const targets = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];
const files = targets.flatMap(target => {
  const base = `strique-${version}-${target}`;
  return [`${base}.tar.gz`, ...(target === 'win32-x64' ? [`${base}.exe`] : target.startsWith('darwin-') ? [`${base}.pkg`] : [])];
}).sort();
// Fail before publishing if a platform is missing, empty, or from a different version.
const actual = fs.readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt').sort();
if (JSON.stringify(actual) !== JSON.stringify(files)) {
  throw new Error(`Expected the complete ${version} release (${files.join(', ')}); found ${actual.join(', ')}`);
}
const checksums = [];
for (const name of files) {
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Release asset is not a nonempty regular file: ${name}`);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}\n`);
}
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums.join(''));
console.log(`Verified all ${files.length} release assets and wrote SHA256SUMS.txt`);
