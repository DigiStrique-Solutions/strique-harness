#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Usage: node setup.mjs [--mode source|packages] [--root DIR] [--home DIR]
                      [--manifest FILE] [--dry-run]
Defaults: source, parent of setup/, ~/strique-dsh-home.
Package specs (registry versions or absolute .tgz paths) live in manifest.json.
Creates an isolated Web profile; never copies credentials or existing sessions.`);
  process.exit(0);
}
const options = { mode: 'source', root: path.dirname(here), home: path.join(os.homedir(), 'strique-dsh-home'), manifest: path.join(here, 'manifest.json') };
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') { dryRun = true; continue; }
  const key = args[i].replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
  options[key] = args[++i];
}
if (!['source', 'packages'].includes(options.mode)) throw new Error('Mode must be source or packages');
for (const key of ['root', 'home', 'manifest']) options[key] = path.resolve(options[key]);
const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major === 22 && minor >= 19 || major >= 24)) throw new Error('Node 22.19+ or 24+ is required');

// Run npm's JavaScript entry directly, including on Windows, without a shell.
function npmEntry() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['npm', 'npm.cmd']) {
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      const real = fs.realpathSync(candidate);
      if (real.endsWith('npm-cli.js')) candidates.push(real);
      candidates.push(path.join(path.dirname(real), 'node_modules/npm/bin/npm-cli.js'));
    }
  }
  const entry = candidates.find(p => p && p.endsWith('npm-cli.js') && fs.existsSync(p));
  if (!entry) throw new Error('Cannot locate npm-cli.js. Install Node with npm and add npm to PATH.');
  return entry;
}
const npm = npmEntry();
const env = { ...process.env, DSH_HOME: options.home, npm_config_cache: path.join(options.home, 'npm-cache') };
function run(argv, cwd) {
  console.log(JSON.stringify({ cwd, command: [process.execPath, npm, ...argv] }));
  if (dryRun) return;
  const result = spawnSync(process.execPath, [npm, ...argv], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}). Correct the error and rerun setup.`);
}
function pm(version, argv, cwd) {
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(version)) throw new Error(`Expected pinned pnpm version: ${version}`);
  run(['exec', '--yes', `--package=${version}`, '--', 'pnpm', ...argv], cwd);
}
const specs = manifest.plugins.map(p => {
  if (options.mode === 'source') {
    const dir = path.resolve(options.root, p.dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.name !== p.name || pkg.version !== p.version) throw new Error(`Source version mismatch: ${p.dir}`);
    return `link:${dir}`;
  }
  if (!p.spec) throw new Error(`No package spec for ${p.name}. Set its spec in ${options.manifest} to a published package or an absolute .tgz path.`);
  if (p.spec.endsWith('.tgz')) {
    const tarball = path.resolve(path.dirname(options.manifest), p.spec);
    if (!fs.existsSync(tarball)) throw new Error(`Tarball does not exist: ${tarball}`);
    return tarball;
  }
  return p.spec;
});
const runtimeDir = path.join(options.home, 'runtime');
const profileDir = path.join(options.home, 'profiles', 'web');
const marker = path.join(options.home, 'setup-owner.json');
const ownership = JSON.stringify({ root: options.root, mode: options.mode, manifest }, null, 2) + '\n';
if (fs.existsSync(options.home)) {
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== ownership) throw new Error('Home already exists and is not owned by this exact setup. Choose a new --home directory.');
} else if (!dryRun) {
  fs.mkdirSync(options.home, { recursive: true });
  fs.writeFileSync(marker, ownership);
}
let cli;
if (options.mode === 'source') {
  const root = path.join(options.root, manifest.harness.dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (`@deepseek-ai/dsh@${pkg.version}` !== manifest.harness.spec) throw new Error('Harness source version does not match manifest');
  pm(manifest.harness.packageManager, ['install', '--frozen-lockfile'], root);
  pm(manifest.harness.packageManager, ['run', 'build'], root);
  cli = path.join(root, 'apps', 'cli', 'lib', 'bin.js');
  for (const plugin of manifest.plugins) {
    const dir = path.join(options.root, plugin.dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) pm(plugin.packageManager, ['install', '--frozen-lockfile'], dir);
    else if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) throw new Error(`Missing pnpm lockfile: ${dir}`);
    if (pkg.scripts?.build) pm(plugin.packageManager, ['run', 'build'], dir);
  }
} else {
  if (!dryRun) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    if (!fs.existsSync(path.join(runtimeDir, 'package.json'))) fs.writeFileSync(path.join(runtimeDir, 'package.json'), JSON.stringify({ private: true }));
  }
  run(['install', '--save-exact', manifest.harness.spec], runtimeDir);
  cli = path.join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}
function dsh(argv) {
  run(['exec', '--yes', `--package=${manifest.harness.packageManager}`, '--', 'node', cli, ...argv], options.mode === 'source' ? path.join(options.root, manifest.harness.dir) : runtimeDir);
}
// The supported plugin command initializes the profile and activates bundles.
dsh(['plugin', '--profile', 'web', 'add', ...specs]);
if (!dryRun) {
  const file = path.join(profileDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const installed = pkg.dsh?.profile?.bundles || [];
  for (const bundle of manifest.bundles) if (!installed.includes(bundle)) throw new Error(`Bundle was not registered: ${bundle}`);
  if (installed.some(bundle => !manifest.bundles.includes(bundle))) throw new Error('Unexpected bundle registered; review the installed plugin manifests.');
  pkg.dsh.profile.bundles = manifest.bundles;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
// Compose configuration without starting the Web server or making model calls.
dsh(['web', '--dump-config']);
if (!dryRun) {
  const launchArgs = [npm, '--cache', path.join(options.home, 'npm-cache'), 'exec', '--yes', `--package=${manifest.harness.packageManager}`, '--', 'node', cli, 'web'];
  const launcher = `import { spawn } from 'node:child_process';\nconst child = spawn(process.execPath, [...${JSON.stringify(launchArgs)}, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DSH_HOME: ${JSON.stringify(options.home)} } });\nchild.on('error', e => { console.error(e.message); process.exitCode = 1; });\nchild.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });\nfor (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));\n`;
  fs.writeFileSync(path.join(options.home, 'start.mjs'), launcher);
}
console.log(`Setup ${dryRun ? 'plan printed' : 'complete'}. Start with: node ${JSON.stringify(path.join(options.home, 'start.mjs'))}`);
