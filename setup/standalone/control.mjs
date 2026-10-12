#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { compareVersions, readUpdate, downloadUpdate, extractUpdate, verifyInventory } from './updates.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(fs.readFileSync(path.join(source, 'release.json'), 'utf8'));
if (release.target !== `${process.platform}-${process.arch}`) throw new Error(`This release is for ${release.target}, not this machine`);
const defaultData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Strique')
  : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Strique')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'Strique');
const data = path.resolve(process.env.STRIQUE_DATA_DIR || defaultData);
const stateFile = path.join(data, 'installation.json');
const home = path.join(data, 'home');
const argv = process.argv.slice(2);
const command = argv.shift() || 'start';
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
function readState() {
  const value = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (value.schemaVersion !== 1 || value.product !== 'Strique') throw new Error('Unrecognized installation state');
  compareVersions(value.current, '0.0.0');
  if (value.previous) compareVersions(value.previous, '0.0.0');
  return value;
}
function saveState(state) {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, stateFile);
}
function currentRoot(state = readState()) { return path.join(data, 'releases', state.current); }
function runtimeEnv() {
  const { NODE_OPTIONS, NODE_PATH, ...env } = process.env;
  const bin = fs.existsSync(stateFile) ? path.join(currentRoot(), 'bin') : path.join(source, 'bin');
  return { ...env, DSH_HOME: home, PATH: `${bin}${path.delimiter}${env.PATH || ''}` };
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process lock');
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}
function running() {
  const file = path.join(data, 'running/owner.json');
  if (!fs.existsSync(file)) return false;
  return alive(JSON.parse(fs.readFileSync(file, 'utf8')).pid);
}
function reopen(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Unexpected local launch address');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const browser = spawn(command, args, { stdio: 'ignore', detached: true });
  browser.on('error', e => console.error(`Could not reopen the browser: ${e.message}`)); browser.unref();
}
function lock() {
  const dir = path.join(data, 'maintenance');
  fs.mkdirSync(data, { recursive: true });
  try { fs.mkdirSync(dir); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = path.join(dir, 'owner.json');
    if (!fs.existsSync(owner) || alive(JSON.parse(fs.readFileSync(owner)).pid)) throw new Error('Another installation/update is in progress');
    fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir);
  }
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  return () => fs.rmSync(dir, { recursive: true });
}
function prepareHome() {
  const dir = path.join(home, 'profiles/web');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'strique-web', private: true,
      dependencies: Object.fromEntries(release.plugins.map(p => [p.name, p.version])),
      dsh: { profile: { bundles: release.bundles } } }, null, 2), { mode: 0o600 });
  }
  if (!fs.existsSync(path.join(dir, 'cordis.patch.yml'))) fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), release.profilePatch || '[]\n', { mode: 0o600 });
  if (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n', { mode: 0o600 });
}
function installTree(tree, version) {
  verifyInventory(tree);
  const destination = path.join(data, 'releases', version);
  if (path.resolve(tree) === path.resolve(destination)) return destination;
  if (fs.existsSync(destination)) {
    verifyInventory(destination);
    if (fs.readFileSync(path.join(destination, 'inventory.json'), 'utf8') !== fs.readFileSync(path.join(tree, 'inventory.json'), 'utf8')) throw new Error('Release version already exists with different contents; publish a new version');
    return destination;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(destination), '.staging-'));
  try { fs.cpSync(tree, stage, { recursive: true }); verifyInventory(stage); fs.renameSync(stage, destination); }
  finally { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true }); }
  return destination;
}
function shortcuts() {
  if (process.env.STRIQUE_DATA_DIR) return; // Isolated/custom homes do not replace normal launch shortcuts.
  if (process.platform === 'linux') {
    const commands = path.join(os.homedir(), '.local/bin'); fs.mkdirSync(commands, { recursive: true });
    const launcher = path.join(commands, 'strique');
    // Read current installation state at each launch; never depend on system Node.
    const escapedData = data.replaceAll("'", "'\\''");
    const initial = path.join(data, 'releases', release.version).replaceAll("'", "'\\''");
    fs.writeFileSync(launcher, `#!/bin/sh\nexport STRIQUE_DATA_DIR='${escapedData}'\nexec '${initial}/bin/node' '${initial}/control.mjs' start "$@"\n`, { mode: 0o755 });
    const desktop = path.join(os.homedir(), '.local/share/applications'); fs.mkdirSync(desktop, { recursive: true });
    fs.writeFileSync(path.join(desktop, 'strique.desktop'), `[Desktop Entry]\nType=Application\nName=Strique\nComment=Local Strique Web application\nExec="${launcher.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"\nTerminal=false\nCategories=Office;\n`);
  }
}
async function install() {
  if (fs.existsSync(data) && !fs.existsSync(stateFile)) {
    const contents = fs.readdirSync(data).filter(p => p !== 'releases');
    if (contents.length) throw new Error('Destination contains unrelated data; choose STRIQUE_DATA_DIR');
  }
  const unlock = lock();
  try {
    if (running()) throw new Error('Close Strique before installing another release');
    const existing = fs.existsSync(stateFile) ? readState() : undefined;
    installTree(source, release.version);
    prepareHome();
    saveState({ schemaVersion: 1, product: 'Strique', current: release.version,
      previous: existing?.current !== release.version ? existing?.current : existing?.previous });
    shortcuts();
  } finally { unlock(); }
  console.log(`Strique ${release.version} installed. User data: ${home}`);
}
async function start() {
  if (!fs.existsSync(stateFile)) await install();
  const unlock = lock();
  let root;
  try {
    if (running()) {
      const owner = JSON.parse(fs.readFileSync(path.join(data, 'running/owner.json')));
      if (owner.url && !argv.includes('--no-open')) reopen(owner.url);
      else console.log('Strique is already running.');
      return;
    }
    const dir = path.join(data, 'running');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    root = currentRoot();
  } finally { unlock(); }
  const cli = path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js');
  fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
  const log = fs.openSync(path.join(data, 'logs/web.log'), 'a', 0o600);
  const child = spawn(path.join(root, 'bin', nodeName), [cli, 'web', '--host', '127.0.0.1', ...argv], {
    cwd: os.homedir(), env: runtimeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const token = randomBytes(32).toString('hex');
  const control = net.createServer(socket => {
    socket.setTimeout(3000, () => socket.destroy());
    let request = '';
    socket.on('data', chunk => {
      request += chunk;
      if (request.length > 1024) { socket.destroy(); return; }
      if (!request.includes('\n')) return;
      if (request.trim() !== token) { socket.end('denied'); return; }
      socket.end('stopping'); child.kill('SIGTERM');
    });
  });
  control.listen(0, '127.0.0.1', () => {
    const address = control.address();
    fs.writeFileSync(path.join(data, 'running/owner.json'), JSON.stringify({ pid: process.pid, port: address.port, token }), { mode: 0o600 });
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true; control.close(); fs.closeSync(log); fs.rmSync(path.join(data, 'running'), { recursive: true, force: true });
  };
  control.on('error', e => { console.error(`Strique control port: ${e.message}`); child.kill('SIGTERM'); });
  let startupOutput = '';
  child.stdout.on('data', chunk => {
    fs.writeSync(log, chunk); if (process.stdout.isTTY) process.stdout.write(chunk);
    startupOutput = (startupOutput + chunk).slice(-16000);
    const url = startupOutput.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s\x1b]*)/)?.[1];
    const ownerFile = path.join(data, 'running/owner.json');
    if (url && fs.existsSync(ownerFile)) {
      const owner = JSON.parse(fs.readFileSync(ownerFile));
      if (owner.url !== url) fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, url }), { mode: 0o600 });
    }
  });
  child.stderr.on('data', chunk => { fs.writeSync(log, chunk); if (process.stderr.isTTY) process.stderr.write(chunk); });
  child.once('error', e => { cleanup(); console.error(e.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { cleanup(); process.exitCode = code ?? (signal ? 1 : 0); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
async function update(apply) {
  const root = currentRoot();
  const installed = JSON.parse(fs.readFileSync(path.join(root, 'release.json')));
  if (!installed.updates) throw new Error('Updates are not configured. Set the HTTPS feed and public key when building a release.');
  const available = await readUpdate(installed.updates, release.target);
  if (compareVersions(available.version, installed.version) <= 0) { console.log('Strique is up to date.'); return; }
  if (!apply) { console.log(`Strique ${available.version} is available. Run the update command after closing Strique.`); return; }
  const unlock = lock();
  let stage;
  try {
    if (running()) throw new Error('Close Strique before updating; updates do not interrupt active sessions.');
    const state = readState();
    if (state.current !== installed.version) throw new Error('The installation changed; retry the update');
    stage = fs.mkdtempSync(path.join(data, '.update-'));
    const archive = path.join(stage, 'release.tar.gz');
    await downloadUpdate(available, archive);
    const tree = extractUpdate(archive, path.join(stage, 'expanded'), `strique-${available.version}-${release.target}`);
    const next = JSON.parse(fs.readFileSync(path.join(tree, 'release.json')));
    if (next.version !== available.version || next.target !== release.target || JSON.stringify(next.updates) !== JSON.stringify(installed.updates)) throw new Error('Update identity or trust configuration differs');
    const smokeHome = path.join(stage, 'smoke-home');
    fs.mkdirSync(path.join(smokeHome, 'profiles/web'), { recursive: true });
    fs.writeFileSync(path.join(smokeHome, 'profiles/web/package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: next.bundles } } }));
    fs.writeFileSync(path.join(smokeHome, 'profiles/web/cordis.patch.yml'), next.profilePatch || '[]\n');
    const smoke = spawnSync(path.join(tree, 'bin', nodeName), [path.join(tree, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--dump-config'], {
      env: { ...runtimeEnv(), DSH_HOME: smokeHome }, stdio: 'ignore', timeout: 60000 });
    if (smoke.error || smoke.status !== 0) throw new Error('New release failed its configuration check; current release was retained');
    installTree(tree, available.version);
    saveState({ ...state, current: available.version, previous: state.current });
    console.log(`Updated to ${available.version}. Launch Strique to use it.`);
  } finally { if (stage) fs.rmSync(stage, { recursive: true, force: true }); unlock(); }
}
async function main() {
  if (command === 'help') {
    console.log('Strique commands: install, start [Web flags], stop, status, check-update, update, rollback.\nUpdates and rollback require Strique to be stopped. STRIQUE_DATA_DIR overrides the user-data directory.'); return;
  }
  if (command === 'install') return install();
  if (command === 'start') return start();
  if (command === 'stop') {
    if (!running()) { console.log('Strique is not running.'); return; }
    const owner = JSON.parse(fs.readFileSync(path.join(data, 'running/owner.json')));
    if (!Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535 || typeof owner.token !== 'string' || !/^[a-f0-9]{64}$/.test(owner.token)) throw new Error('Strique is still starting or its process record is invalid; retry shortly');
    await new Promise((resolve, reject) => {
      const socket = net.connect(owner.port, '127.0.0.1');
      let reply = '';
      socket.setTimeout(5000, () => socket.destroy(new Error('Stop request timed out')));
      socket.on('connect', () => socket.write(`${owner.token}\n`));
      socket.on('data', chunk => { reply += chunk; });
      socket.on('error', reject);
      socket.on('end', () => reply === 'stopping' ? resolve() : reject(new Error('Stop request refused')));
    });
    console.log('Strique is stopping.'); return;
  }
  if (command === 'status') { console.log(fs.existsSync(stateFile) ? JSON.stringify({ ...readState(), running: running(), data }, null, 2) : 'Not installed'); return; }
  if (command === 'check-update') return update(false);
  if (command === 'update') return update(true);
  if (command === 'rollback') {
    const unlock = lock();
    try {
      if (running()) throw new Error('Close Strique before rollback');
      const state = readState();
      if (!state.previous) throw new Error('No previous release exists');
      verifyInventory(path.join(data, 'releases', state.previous));
      saveState({ ...state, current: state.previous, previous: state.current });
      console.log(`Application rolled back to ${state.previous}. User data was retained.`);
    } finally { unlock(); }
    return;
  }
  throw new Error(`Unknown command ${command}`);
}
main().catch(e => { console.error(`Strique: ${e.message}`); process.exitCode = 1; });
