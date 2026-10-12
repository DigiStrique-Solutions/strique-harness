#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--help')) {
  console.log('Usage: npm exec -- node setup/pack-plugins.mjs NEW_OUTPUT_DIRECTORY\nPackages existing plugin builds into a transferable package-mode setup. Build the plugins first.');
  process.exit(0);
}
if (process.argv.length !== 3) throw new Error('Provide one new output directory.');
const npm = process.env.npm_execpath;
if (!npm || !npm.endsWith('npm-cli.js')) throw new Error('Run through npm exec: npm exec -- node setup/pack-plugins.mjs OUTPUT');
const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw new Error('Output already exists; choose a new directory.');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const packages = path.join(output, 'packages');
fs.mkdirSync(packages, { recursive: true });
for (const plugin of manifest.plugins) {
  const dir = path.join(path.dirname(here), plugin.dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.name !== plugin.name || pkg.version !== plugin.version) throw new Error(`Source version mismatch: ${plugin.dir}`);
  const result = spawnSync(process.execPath, [npm, '--cache', path.join(output, '.npm-cache'), 'pack', '--ignore-scripts', '--json', '--pack-destination', packages], { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Packing failed: ${plugin.dir}: ${result.error?.message || result.stderr}`);
  const [packed] = JSON.parse(result.stdout);
  const files = new Set(packed.files.map(file => file.path));
  function exportFiles(value) {
    if (typeof value === 'string') return value.startsWith('./') && !value.includes('*') ? [value] : [];
    if (value && typeof value === 'object') return Object.values(value).flatMap(exportFiles);
    return [];
  }
  const required = [pkg.main, pkg.dsh?.bundle?.patch, ...exportFiles(pkg.exports)].filter(Boolean).map(file => file.replace(/^\.\//, ''));
  for (const file of required) if (!files.has(file)) throw new Error(`Package is missing ${file}; build ${plugin.dir} before packing.`);
  plugin.spec = `../packages/${packed.filename}`;
  console.log(`Packed ${plugin.name}@${plugin.version}`);
}
fs.cpSync(here, path.join(output, 'setup'), { recursive: true });
fs.writeFileSync(path.join(output, 'setup', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.rmSync(path.join(output, '.npm-cache'), { recursive: true, force: true });
console.log(`Copy ${output} to the target, then run node setup/setup.mjs --mode packages. Registry access for Harness and package dependencies is still required.`);
