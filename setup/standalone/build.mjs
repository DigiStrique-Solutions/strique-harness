#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { assemblePackages, findPackage, inventory } from './package-tree.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const options = { root: path.resolve(here, '../..'), out: path.resolve(here, '../../Workspace-dsh/standalone'), version: '0.1.0', target: `${process.platform}-${process.arch}`, 'update-url': '', 'public-key': '' };
let installer = true;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--help') {
    console.log('node setup/standalone/build.mjs --version X.Y.Z [--out DIR] [--root DIR] [--target OS-ARCH] [--portable-only] [--update-url HTTPS_URL --public-key PEM_FILE]\nBuild dependencies and Harness/plugins first. Target must match the current build host.'); process.exit(0);
  }
  if (arg === '--portable-only') { installer = false; continue; }
  const key = arg.replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error(`Invalid argument ${arg}`);
  options[key] = process.argv[++i];
}
if (!/^\d+\.\d+\.\d+$/.test(options.version)) throw new Error('Release version must be X.Y.Z');
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64'];
if (!targets.includes(options.target)) throw new Error(`Supported targets: ${targets.join(', ')}`);
if (options.target !== `${process.platform}-${process.arch}`) throw new Error('Build on the target OS and architecture; native dependencies cannot be copied across targets.');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Build using Node 24+');
if (Boolean(options['update-url']) !== Boolean(options['public-key'])) throw new Error('Configure both update URL and public verification key, or neither.');
if (options['update-url'] && new URL(options['update-url']).protocol !== 'https:') throw new Error('Update URL must use HTTPS');
if (options['public-key'] && createPublicKey(fs.readFileSync(options['public-key'])).asymmetricKeyType !== 'ed25519') throw new Error('Update public key must be Ed25519');
const root = path.resolve(options.root);
const out = path.resolve(options.out);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'setup/manifest.json'), 'utf8'));
const bundle = path.join(out, `strique-${options.version}-${options.target}`);
if (fs.existsSync(bundle)) throw new Error(`Build directory already exists: ${bundle}`);
const cli = path.join(root, manifest.harness.dir, 'apps/cli');
const pnpm = findPackage('pnpm', path.join(root, manifest.harness.dir));
if (!pnpm) throw new Error('Install the Harness development dependencies before packaging (bundled pnpm is required).');
const sources = [cli, ...manifest.plugins.map(p => {
  const dir = path.join(root, p.dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.name !== p.name || pkg.version !== p.version) throw new Error(`Plugin identity mismatch: ${p.dir}`);
  return dir;
})];
for (const dir of sources) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = pkg.main || (pkg.bin?.dsh);
  if (file && !fs.existsSync(path.join(dir, file))) throw new Error(`Missing built entry for ${pkg.name}; build before packaging.`);
}
fs.mkdirSync(path.join(bundle, 'bin'), { recursive: true });
const node = path.join(bundle, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
fs.copyFileSync(process.execPath, node);
fs.chmodSync(node, 0o755);
console.log(`Assembling ${options.target} runtime dependencies from installed, locked source trees...`);
const workspace = new Map();
const harnessRoot = path.join(root, manifest.harness.dir);
for (const relative of fs.globSync(['packages/*/*/package.json', 'vendor/*/package.json', 'apps/*/package.json', 'native/system/packages/*/package.json', 'native/system/package.json'], { cwd: harnessRoot })) {
  const file = path.join(harnessRoot, relative);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  workspace.set(pkg.name, path.dirname(file));
}
const packages = assemblePackages([...sources, pnpm], path.join(bundle, 'runtime/node_modules'), { workspace, pluginRoots: new Set(manifest.plugins.map(p => p.name)) });
// Register bundled third-party plugins in the installation-owned resolver graph.
// A profile can then select their bundles without absolute links or node_modules projections.
const cliManifest = path.join(bundle, 'runtime/node_modules/@deepseek-ai/dsh/package.json');
const deployedCli = JSON.parse(fs.readFileSync(cliManifest, 'utf8'));
deployedCli.dependencies = { ...deployedCli.dependencies, ...Object.fromEntries(manifest.plugins.map(p => [p.name, p.version])) };
fs.writeFileSync(cliManifest, JSON.stringify(deployedCli, null, 2));
fs.writeFileSync(path.join(bundle, 'runtime/package.json'), JSON.stringify({ private: true, type: 'module' }));
for (const file of ['control.mjs', 'updates.mjs']) fs.copyFileSync(path.join(here, file), path.join(bundle, file));
const release = { schemaVersion: 1, product: 'Strique', version: options.version, target: options.target, node: process.versions.node,
  harness: manifest.harness.spec, bundles: manifest.bundles,
  plugins: manifest.plugins.map(p => ({ name: p.name, version: p.version })),
  profilePatch: '- id: hmr\n  disabled: true\n- id: client-hmr\n  disabled: true\n',
  updates: options['update-url'] ? { url: options['update-url'], publicKey: fs.readFileSync(options['public-key'], 'utf8') } : null };
fs.writeFileSync(path.join(bundle, 'release.json'), JSON.stringify(release, null, 2));
fs.writeFileSync(path.join(bundle, 'packages.json'), JSON.stringify(packages, null, 2));
fs.writeFileSync(path.join(bundle, 'Launch Strique.command'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./bin/node ./control.mjs start\n', { mode: 0o755 });
fs.writeFileSync(path.join(bundle, 'Stop Strique.command'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./bin/node ./control.mjs stop\n', { mode: 0o755 });
fs.writeFileSync(path.join(bundle, 'Install Strique.command'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./bin/node ./control.mjs install\n', { mode: 0o755 });
fs.writeFileSync(path.join(bundle, 'launch.cmd'), '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0control.mjs" start %*\r\n');
fs.writeFileSync(path.join(bundle, 'stop.cmd'), '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0control.mjs" stop\r\n');
fs.writeFileSync(path.join(bundle, 'bin/pnpm'), '#!/bin/sh\nBASE="$(cd "$(dirname "$0")/.." && pwd)"\nexec "$BASE/bin/node" "$BASE/runtime/node_modules/pnpm/bin/pnpm.cjs" "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(bundle, 'bin/pnpm.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0..\\runtime\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n');
fs.writeFileSync(path.join(bundle, 'install.cmd'), '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0control.mjs" install %*\r\npause\r\n');
fs.writeFileSync(path.join(bundle, 'install.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./bin/node ./control.mjs install "$@"\n', { mode: 0o755 });
fs.copyFileSync(path.join(root, manifest.harness.dir, 'LICENSE'), path.join(bundle, 'HARNESS-LICENSE'));
fs.copyFileSync(path.join(root, manifest.harness.dir, 'THIRD_PARTY_NOTICES.md'), path.join(bundle, 'THIRD_PARTY_NOTICES.md'));
fs.writeFileSync(path.join(bundle, 'README.txt'), 'Strique local Web application. Use the platform installer, or run the bundled Install script. No system Node/npm/Git is needed. Configure model credentials and optional external tools separately. Launch opens the local Web interface. In a terminal: bin/node control.mjs help\n');
// Sanity-check this exact production graph before creating any installer.
function run(command, argv, cwd = bundle) {
  const result = spawnSync(command, argv, { cwd, stdio: 'inherit', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
run(node, [path.join(bundle, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), '--version']);
fs.writeFileSync(path.join(bundle, 'inventory.json'), JSON.stringify(inventory(bundle)));
run(node, [path.join(here, 'smoke.mjs'), bundle]);
console.log(`Verified ${packages.length} installed packages. Creating portable update archive...`);
const archive = `${bundle}.tar.gz`;
run('tar', ['-czf', archive, '-C', out, path.basename(bundle)], out);
if (installer && process.platform === 'darwin') {
  const app = path.join(out, `mac-payload-${options.version}-${options.target}`, 'Strique.app');
  const resources = path.join(app, 'Contents/Resources');
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.cpSync(bundle, path.join(resources, 'app'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/MacOS/Strique'), '#!/bin/sh\nAPP="$(cd "$(dirname "$0")/../Resources/app" && pwd)"\nexec "$APP/bin/node" "$APP/control.mjs" start\n', { mode: 0o755 });
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.strique.web</string><key>CFBundleName</key><string>Strique</string><key>CFBundleExecutable</key><string>Strique</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${options.version}</string><key>LSUIElement</key><true/></dict></plist>`);
  const components = path.join(out, 'mac-components.plist');
  fs.writeFileSync(components, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array><dict><key>RootRelativeBundlePath</key><string>Strique.app</string><key>BundleIsRelocatable</key><false/><key>BundleIsVersionChecked</key><false/><key>BundleHasStrictIdentifier</key><true/><key>BundleOverwriteAction</key><string>upgrade</string></dict></array></plist>');
  run('/usr/bin/pkgbuild', ['--root', path.dirname(app), '--component-plist', components, '--identifier', 'com.strique.web', '--version', options.version, '--install-location', '/Applications', `${bundle}.pkg`], out);
} else if (installer && process.platform === 'win32') {
  const script = path.join(out, `strique-${options.version}.nsi`);
  const esc = p => p.replaceAll('$', '$$').replaceAll('"', '$\\"');
  fs.writeFileSync(script, `Unicode true\nName "Strique"\nOutFile "${esc(`${bundle}.exe`)}"\nRequestExecutionLevel user\nSilentInstall normal\nSection\nSetShellVarContext current\nSetOutPath "$LOCALAPPDATA\\Strique\\releases\\${options.version}"\nFile /r "${esc(bundle)}\\*"\nExecWait '\"$OUTDIR\\bin\\node.exe\" \"$OUTDIR\\control.mjs\" install --already-installed' $0\nIntCmp $0 0 +3\nMessageBox MB_ICONSTOP "Strique installation failed."\nAbort\nCreateShortCut "$DESKTOP\\Strique.lnk" "$OUTDIR\\bin\\node.exe" '\"$OUTDIR\\control.mjs\" start'\nCreateShortCut "$SMPROGRAMS\\Strique.lnk" "$OUTDIR\\bin\\node.exe" '\"$OUTDIR\\control.mjs\" start'\nSectionEnd\n`);
  const nsis = process.env.MAKENSIS || 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
  run(nsis, [script], out);
}
console.log(`Complete: ${bundle}\nPortable archive: ${archive}\n${installer && process.platform !== 'linux' ? 'Native installer created (unsigned until release signing is configured).' : 'Linux/portable installation: extract archive and run install.sh.'}`);
