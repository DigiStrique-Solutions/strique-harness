import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { assemblePackages, inventory } from './package-tree.mjs';
import { verifyFeed, compareVersions, verifyInventory, extractUpdate } from './updates.mjs';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { windowsInstallerScript } from './windows-installer.mjs';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strique-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function pkg(dir, name, version, dependencies = {}, code = `export default '${version}'`) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'index.js', files: ['index.js'], dependencies }));
  fs.writeFileSync(path.join(dir, 'index.js'), code);
}
test('production packaging preserves conflicting dependency versions and cycles after relocation', t => {
  const dir = temporary(t);
  pkg(path.join(dir, 'a'), 'a', '1.0.0', { shared: '1.0.0', b: '1.0.0' });
  pkg(path.join(dir, 'b'), 'b', '1.0.0', { shared: '2.0.0', a: '1.0.0' });
  pkg(path.join(dir, 'node_modules/a'), 'a', '1.0.0', { shared: '1.0.0', b: '1.0.0' });
  pkg(path.join(dir, 'node_modules/b'), 'b', '1.0.0', { shared: '2.0.0', a: '1.0.0' });
  pkg(path.join(dir, 'node_modules/shared'), 'shared', '1.0.0');
  pkg(path.join(dir, 'b/node_modules/shared'), 'shared', '2.0.0');
  pkg(path.join(dir, 'node_modules/b/node_modules/shared'), 'shared', '2.0.0');
  const original = path.join(dir, 'original/node_modules');
  const records = assemblePackages([path.join(dir, 'a'), path.join(dir, 'b')], original);
  assert.equal(records.length, 4);
  fs.renameSync(path.join(dir, 'original'), path.join(dir, 'relocated'));
  const a = createRequire(path.join(dir, 'relocated/node_modules/a/package.json'));
  const b = createRequire(path.join(dir, 'relocated/node_modules/b/package.json'));
  assert.equal(JSON.parse(fs.readFileSync(a.resolve('shared/package.json'))).version, '1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(b.resolve('shared/package.json'))).version, '2.0.0');
  assert.equal(b.resolve('a'), fs.realpathSync(path.join(dir, 'relocated/node_modules/a/index.js')));
});
test('packaging excludes source credentials, maps, and development-only dependencies', t => {
  const dir = temporary(t);
  pkg(path.join(dir, 'source'), 'example', '1.0.0');
  const source = path.join(dir, 'source');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  manifest.files = ['**/*']; manifest.devDependencies = { unavailable: '1.0.0' };
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, '.env'), 'secret');
  fs.writeFileSync(path.join(source, '.npmrc'), 'secret');
  fs.writeFileSync(path.join(source, 'index.js.map'), 'source');
  const out = path.join(dir, 'out/node_modules'); assemblePackages([source], out);
  for (const name of ['.env', '.npmrc', 'index.js.map']) assert.equal(fs.existsSync(path.join(out, 'example', name)), false);
  assert.equal(fs.existsSync(path.join(out, 'unavailable')), false);
});
test('signed feeds reject tampering, wrong platforms, and insecure archive URLs', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const value = { schemaVersion: 1, version: '1.2.0', target: 'linux-x64', archive: 'https://example.invalid/package.tar.gz', bytes: 50, sha256: 'a'.repeat(64) };
  const envelope = value => { const payload = Buffer.from(JSON.stringify(value)); return { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }; };
  assert.equal(verifyFeed(envelope(value), publicKey, 'linux-x64').version, '1.2.0');
  const tampered = envelope(value); tampered.payload = Buffer.from(JSON.stringify({ ...value, version: '9.0.0' })).toString('base64');
  assert.throws(() => verifyFeed(tampered, publicKey, 'linux-x64'), /signature/);
  assert.throws(() => verifyFeed(envelope(value), publicKey, 'win32-x64'), /descriptor/);
  assert.throws(() => verifyFeed(envelope({ ...value, archive: 'http://example.invalid/file' }), publicKey, 'linux-x64'), /HTTPS/);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.throws(() => compareVersions('../bad', '1.0.0'), /version/);
});
test('release verification rejects modified and unlisted files', t => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, 'program.js'), 'original');
  fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory(root)));
  verifyInventory(root);
  fs.writeFileSync(path.join(root, 'extra'), 'unexpected');
  assert.throws(() => verifyInventory(root), /Unlisted/);
  fs.unlinkSync(path.join(root, 'extra'));
  fs.writeFileSync(path.join(root, 'program.js'), 'modified');
  assert.throws(() => verifyInventory(root), /verification failed/);
});
test('update extraction refuses an unexpected archive root before writing files', t => {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'wrong-root'));
  fs.writeFileSync(path.join(dir, 'wrong-root/file'), 'test');
  const archive = path.join(dir, 'test.tar.gz');
  const result = spawnSync('tar', ['-czf', archive, '-C', dir, 'wrong-root']);
  assert.equal(result.status, 0);
  const output = path.join(dir, 'expanded');
  assert.throws(() => extractUpdate(archive, output, 'strique-1.0.0-linux-x64'), /archive path/);
  assert.equal(fs.existsSync(output), false);
});

function applicationFixture(dir, version) {
  const root = path.join(dir, `app-${version}`);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const node = path.join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, node, fs.constants.COPYFILE_FICLONE);
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['control.mjs', 'updates.mjs']) fs.copyFileSync(path.join(here, file), path.join(root, file));
  const cli = path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib');
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(cli, 'bin.js'), 'if (process.argv.includes("--dump-config")) process.exit(0); setInterval(() => {}, 1000);');
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ schemaVersion: 1, product: 'Strique', version,
    target: `${process.platform}-${process.arch}`, bundles: [], plugins: [], updates: null }));
  fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory(root)));
  return root;
}
function controller(root, data, command) {
  const result = spawnSync(process.execPath, [path.join(root, 'control.mjs'), command], {
    env: { ...process.env, STRIQUE_DATA_DIR: data }, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
test('archive-based Windows installer preserves runtime files beyond MAX_PATH', t => {
  const dir = temporary(t), data = path.join(dir, 'user-data');
  const root = applicationFixture(dir, '1.0.0');
  const deep = ['runtime', 'node_modules', '@deepseek-ai', 'dsh-experimental-inspector', 'lib', 'devtools', 'models', 'issues_manager', 'descriptions', 'selectElementAccessibilityInteractiveContentAttributesSelectDescendant.md'].join('/');
  fs.mkdirSync(path.dirname(path.join(root, deep)), { recursive: true });
  fs.writeFileSync(path.join(root, deep), 'long-path runtime asset');
  fs.copyFileSync(process.execPath, path.join(root, 'bin/node.exe'));
  fs.unlinkSync(path.join(root, 'inventory.json'));
  fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory(root)));
  const expectedRoot = 'strique-1.0.0-win32-x64';
  const parent = path.join(dir, 'package-source-with-a-long-directory-name');
  fs.mkdirSync(parent);
  const bundle = path.join(parent, expectedRoot);
  fs.renameSync(root, bundle);
  assert.ok(path.join(bundle, deep).length > 260);
  const archive = path.join(dir, 'payload.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', parent, expectedRoot]).status, 0);
  const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const env = { ...process.env, STRIQUE_DATA_DIR: data };
  let installed;
  if (process.platform === 'win32') {
    const script = path.join(dir, 'installer.nsi');
    fs.writeFileSync(script, windowsInstallerScript({ version: '1.0.0', bundle, archive, hash,
      bootstrap: path.join(here, 'windows-bootstrap.mjs'), updates: path.join(here, 'updates.mjs') }));
    const compiler = process.env.MAKENSIS || 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
    const compiled = spawnSync(compiler, [script], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    installed = spawnSync(`${bundle}.exe`, ['/S'], { env, encoding: 'utf8', timeout: 60000 });
  } else {
    installed = spawnSync(process.execPath, [path.join(here, 'windows-bootstrap.mjs'), archive, expectedRoot, hash], {
      env, encoding: 'utf8', timeout: 60000,
    });
  }
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(fs.readFileSync(path.join(data, 'releases/1.0.0', deep), 'utf8'), 'long-path runtime asset');
  verifyInventory(path.join(data, 'releases/1.0.0'));
});
test('installation and rollback preserve user files and refuse a modified release', t => {
  const dir = temporary(t), data = path.join(dir, 'user-data');
  const first = applicationFixture(dir, '1.0.0'), next = applicationFixture(dir, '1.1.0');
  controller(first, data, 'install');
  const settings = path.join(data, 'home/credentials.txt'); fs.writeFileSync(settings, 'private-user-settings');
  controller(next, data, 'install');
  assert.equal(JSON.parse(controller(next, data, 'status')).current, '1.1.0');
  controller(next, data, 'rollback');
  assert.equal(JSON.parse(controller(next, data, 'status')).current, '1.0.0');
  assert.equal(fs.readFileSync(settings, 'utf8'), 'private-user-settings');
  fs.writeFileSync(path.join(next, 'release.json'), '{}');
  const invalid = spawnSync(process.execPath, [path.join(next, 'control.mjs'), 'install'], {
    env: { ...process.env, STRIQUE_DATA_DIR: data }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.equal(JSON.parse(controller(first, data, 'status')).current, '1.0.0');
  assert.throws(() => verifyInventory(next), /verification failed/);
});
test('installed verifier leaves caller-owned files for cleanup after its executable exits', { skip: process.env.STRIQUE_TEST_NETWORK !== '1' }, t => {
  const dir = temporary(t), data = path.join(dir, 'installed-data');
  const root = applicationFixture(dir, '1.0.0');
  fs.writeFileSync(path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), `
    const http = require('node:http');
    const server = http.createServer((_req, res) => { res.end('<title>Strique</title>'); });
    server.listen(0, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + server.address().port));
  `);
  fs.unlinkSync(path.join(root, 'inventory.json'));
  fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory(root)));
  controller(root, data, 'install');
  const installed = path.join(data, 'releases/1.0.0');
  const node = path.join(installed, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
  const result = spawnSync(node, [fileURLToPath(new URL('./verify-installed.mjs', import.meta.url)), installed, data], {
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(node), 'Verifier must not delete its own executable or caller-owned release');
  verifyInventory(installed);
});
test('launcher starts without system Node on PATH and authenticates stop requests', { skip: process.env.STRIQUE_TEST_NETWORK !== '1' }, async t => {
  const dir = temporary(t), data = path.join(dir, 'user-data'), root = applicationFixture(dir, '1.0.0');
  controller(root, data, 'install');
  const child = spawn(process.execPath, [path.join(root, 'control.mjs'), 'start'], {
    env: { ...process.env, STRIQUE_DATA_DIR: data, PATH: path.join(dir, 'empty-path') }, stdio: 'ignore' });
  const stopped = once(child, 'exit');
  t.after(() => child.kill());
  let ready = false;
  for (let tries = 0; tries < 100; tries++) {
    const file = path.join(data, 'running/owner.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).port) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true);
  assert.equal(JSON.parse(controller(root, data, 'status')).running, true);
  controller(root, data, 'stop');
  let timeout;
  try { await Promise.race([stopped, new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Launcher did not stop')), 10000); })]); }
  finally { clearTimeout(timeout); }
  assert.equal(JSON.parse(controller(root, data, 'status')).running, false);
});

test('signed HTTPS update stages a release, preserves user data, and rejects tampered metadata', { skip: process.env.STRIQUE_TEST_NETWORK !== '1' }, async t => {
  const dir = temporary(t), data = path.join(dir, 'user-data');
  const certificate = path.join(dir, 'certificate.pem'), tlsKey = path.join(dir, 'tls.pem');
  const configFile = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(configFile, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
  const certificateResult = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tlsKey, '-out', certificate, '-days', '1', '-config', configFile], { encoding: 'utf8' });
  if (certificateResult.error?.code === 'ENOENT') { t.skip('OpenSSL is needed for the temporary HTTPS fixture'); return; }
  assert.equal(certificateResult.status, 0, certificateResult.stderr);
  let envelope, archiveBytes;
  const server = https.createServer({ cert: fs.readFileSync(certificate), key: fs.readFileSync(tlsKey) }, (req, res) => {
    if (req.url === '/latest.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(envelope)); }
    else if (req.url === '/release.tar.gz') res.end(archiveBytes);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `https://127.0.0.1:${server.address().port}`;
  const keys = generateKeyPairSync('ed25519');
  const updates = { url: `${base}/latest.json`, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
  const first = applicationFixture(dir, '1.0.0');
  const second = applicationFixture(dir, '1.1.0');
  for (const root of [first, second]) {
    const file = path.join(root, 'release.json'); const release = JSON.parse(fs.readFileSync(file));
    release.updates = updates; fs.writeFileSync(file, JSON.stringify(release));
    fs.unlinkSync(path.join(root, 'inventory.json'));
    fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory(root)));
  }
  const target = `${process.platform}-${process.arch}`;
  const expectedRoot = `strique-1.1.0-${target}`;
  fs.renameSync(second, path.join(dir, expectedRoot));
  const archive = path.join(dir, 'release.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', dir, expectedRoot]).status, 0);
  archiveBytes = fs.readFileSync(archive);
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, version: '1.1.0', target, archive: `${base}/release.tar.gz`, bytes: archiveBytes.length, sha256: createHash('sha256').update(archiveBytes).digest('hex') }));
  const signed = { payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') };
  controller(first, data, 'install');
  const userFile = path.join(data, 'home/user-settings'); fs.writeFileSync(userFile, 'keep-me');
  async function invoke(command) {
    const child = spawn(process.execPath, [path.join(first, 'control.mjs'), command], { env: { ...process.env, STRIQUE_DATA_DIR: data, NODE_EXTRA_CA_CERTS: certificate }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const [status] = await once(child, 'exit'); return { status, stdout, stderr };
  }
  envelope = { ...signed, signature: Buffer.alloc(64).toString('base64') };
  const invalid = await invoke('update'); assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /signature/);
  assert.equal(JSON.parse(controller(first, data, 'status')).current, '1.0.0');
  envelope = signed;
  const check = await invoke('check-update'); assert.equal(check.status, 0, check.stderr); assert.match(check.stdout, /1.1.0 is available/);
  const result = await invoke('update'); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(controller(first, data, 'status')).current, '1.1.0');
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'keep-me');
});
