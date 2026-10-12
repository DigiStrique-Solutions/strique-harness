import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, chmod, readFile, writeFile, rm, symlink, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createServer, request } from 'node:http'
import { SkillManager } from '../lib/index.js'
import { createHandler, localRequest } from '../lib/types/http.js'
import { runProcess, childEnvironment } from '../lib/types/process.js'

const exec = promisify(execFile)
const markdown = (name = 'alpha', description = 'Safe test skill', body = 'Original body') => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body}\n`
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'skills-fork-test-')))
  const storageDir = join(root, 'storage')
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'SKILL.md'), markdown())
  const ctx = { workspaceRegistry: { list: () => [{ path: root }] }, connection: { requestRejection: req => req.headers.cookie === 'fixture=authorized' ? undefined : 401 } }
  const manager = new SkillManager(ctx, { storageDir })
  t.after(async () => { await manager.dispose(); await rm(root, { recursive: true, force: true }) })
  const state = async () => JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  const body = async () => readFile(join(storageDir, 'objects', (await state()).installs.alpha.object, 'SKILL.md'), 'utf8')
  return { root, source, storageDir, manager, state, body, ctx }
}

test('F1 structured metadata does not turn descriptions into options; all selections are validated', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'SKILL.md'), markdown('alpha', '--global'))
  const inspected = await f.manager.inspect(f.source)
  assert.deepEqual(inspected.entries, [{ name: 'alpha', description: '--global' }])
  for (const selection of [['--global'], ['../alpha'], ['missing'], [], ['alpha', 'alpha']]) await assert.rejects(f.manager.install(f.source, selection))
  assert.deepEqual((await f.manager.catalog()).entries, [])
  await f.manager.install(f.source, ['alpha'], undefined, undefined, inspected.snapshot)
  assert.equal((await f.manager.catalog()).entries[0].globalEnabled, false)
})

test('F2 source edits after snapshot cannot change published bytes', async t => {
  const f = await fixture(t)
  const original = await readFile(join(f.source, 'SKILL.md'), 'utf8')
  const external = join(f.root, 'sentinel')
  await writeFile(external, 'OUTSIDE-SENTINEL')
  const lock = f.manager.storage.lock.bind(f.manager.storage)
  f.manager.storage.lock = async (...args) => {
    await rm(join(f.source, 'SKILL.md'))
    await symlink(external, join(f.source, 'SKILL.md'))
    return lock(...args)
  }
  await f.manager.install(f.source)
  assert.equal(await f.body(), original)
})

test('F2 inspection digest binds confirmation to source content', async t => {
  const f = await fixture(t)
  const inspected = await f.manager.inspect(f.source)
  await writeFile(join(f.source, 'SKILL.md'), markdown('alpha', 'Changed source'))
  await assert.rejects(f.manager.install(f.source, ['alpha'], undefined, undefined, inspected.snapshot), /changed since inspection/)
  assert.deepEqual((await f.manager.catalog()).entries, [])
})

test('F2 rejects internal, external, directory and broken symlinks', async t => {
  const f = await fixture(t)
  for (const target of [join(f.source, 'SKILL.md'), f.root, join(f.root, 'missing')]) {
    await symlink(target, join(f.source, 'link'))
    await assert.rejects(f.manager.install(f.source), /symlink/)
    await rm(join(f.source, 'link'))
  }
})

test('F3 source collisions and explicit update-source replacement preserve enabled original', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  await f.manager.setEnabled('alpha', 'global', undefined, true)
  const replacement = join(f.root, 'replacement')
  await mkdir(replacement)
  await writeFile(join(replacement, 'SKILL.md'), markdown('alpha', 'Replacement'))
  await assert.rejects(f.manager.install(replacement), /already installed/)
  await assert.rejects(f.manager.update('alpha', replacement), /recorded source/)
  assert.match(await f.body(), /Original body/)
  assert.equal((await f.manager.catalog()).entries[0].globalEnabled, true)
  await f.manager.remove('alpha')
  await f.manager.install(replacement)
  assert.equal((await f.manager.catalog()).entries[0].globalEnabled, false)
})

test('F4 request locality uses peer, authority and proxy facts', () => {
  const req = (remoteAddress, host, headers = {}) => ({ socket: { remoteAddress }, headers: { host, ...headers } })
  assert.equal(localRequest(req('127.0.0.1', 'localhost:3080')), true)
  assert.equal(localRequest(req('::1', '[::1]:3080')), true)
  assert.equal(localRequest(req('10.0.0.2', 'localhost:3080')), false)
  assert.equal(localRequest(req('127.0.0.1', 'tunnel.example')), false)
  assert.equal(localRequest(req('127.0.0.1', 'localhost:3080', { 'x-forwarded-for': '10.0.0.2' })), false)
})

test('F4 authenticated HTTP rejects remote mutations and unregistered workspace scopes', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const server = createServer(createHandler(f.ctx, f.manager))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = `http://127.0.0.1:${server.address().port}/skills-manager-secure/`
  const post = (endpoint, payload, headers = {}) => new Promise((resolve, reject) => {
    const req = request(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'fixture=authorized', ...headers } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body) }))
    }); req.on('error', reject); req.end(JSON.stringify({ type: 'client-request', rpcId: 'test', method: endpoint, payload }))
  })
  assert.equal((await post('list', {}, { cookie: '' })).status, 401)
  const remote = await post('list', {}, { host: 'tunnel.example' })
  assert.equal((await remote.json()).result.value.writable, false)
  for (const endpoint of ['inspect', 'install', 'update', 'update-many', 'remove', 'set-enabled', 'set-model-invocation', 'check-updates']) assert.equal((await post(endpoint, {}, { host: 'tunnel.example' })).status, 403)
  const invalid = await post('set-enabled', { name: 'alpha', scope: 'project', projectRoot: '/unregistered', enabled: true })
  const failure = (await invalid.json()).result.error
  assert.match(failure.message, /registered workspace/)
  assert.deepEqual(failure.details, {}, 'business failures must satisfy the Harness browser RPC error contract')
  assert.deepEqual((await f.state()).globalEnabled, [])
  const oversized = await post('inspect', { path: 'x'.repeat(20_000) })
  assert.match((await oversized.json()).result.error.message, /16 KiB/)
  const valid = await post('set-enabled', { name: 'alpha', scope: 'project', projectRoot: f.root, enabled: true })
  assert.equal((await valid.json()).result.ok, true)
  const batch = await post('update-many', { names: ['alpha'] })
  assert.deepEqual((await batch.json()).result.value.results, [{ names: ['alpha'], ok: true }])
})

test('F5 already-cancelled and queued requests do not mutate', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const before = await f.state()
  const cancelled = AbortSignal.abort()
  await assert.rejects(f.manager.setEnabled('alpha', 'global', undefined, true, cancelled))
  await assert.rejects(f.manager.install(f.source, undefined, undefined, cancelled))
  const lockPath = join(f.storageDir, '.mutation-lock')
  await mkdir(lockPath)
  const controller = new AbortController()
  const operation = f.manager.setEnabled('alpha', 'global', undefined, true, controller.signal)
  controller.abort()
  await assert.rejects(operation)
  await rm(lockPath, { recursive: true })
  assert.deepEqual(await f.state(), before)
  await f.manager.dispose()
  await assert.rejects(f.manager.setEnabled('alpha', 'global', undefined, true))
})

test('F5 process cancellation kills descendants and does not inherit secrets', async t => {
  const f = await fixture(t)
  const marker = join(f.root, 'pids.json')
  const controller = new AbortController()
  const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)`
  const running = runProcess(process.execPath, ['-e', script, marker], controller.signal)
  for (let i = 0; i < 100; i++) { if (await readFile(marker).catch(() => undefined)) break; await new Promise(resolve => setTimeout(resolve, 10)) }
  controller.abort()
  await assert.rejects(running, /cancelled/)
  const pids = JSON.parse(await readFile(marker, 'utf8'))
  for (const pid of pids) {
    for (let i = 0; i < 100; i++) { try { process.kill(pid, 0) } catch { break }; await new Promise(resolve => setTimeout(resolve, 10)) }
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  }
  assert.equal(childEnvironment().HOME, undefined)
  assert.equal(childEnvironment().OPENAI_API_KEY, undefined)
  assert.equal(childEnvironment().NODE_OPTIONS, undefined)
})

test('F6 separate instances reload state under the shared mutation lock', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const other = new SkillManager(f.ctx, { storageDir: f.storageDir })
  t.after(() => other.dispose())
  await other.catalog()
  await Promise.all([f.manager.setEnabled('alpha', 'global', undefined, true), other.setModelInvocable('alpha', false)])
  assert.deepEqual((await f.state()).globalEnabled, ['alpha'])
  assert.deepEqual((await f.state()).modelInvocation, { alpha: false })
  assert.equal((await other.catalog()).entries[0].globalEnabled, true)
})

test('F6 separate processes preserve concurrent enablement and invocation changes', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const script = `import {SkillManager} from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)};const m=new SkillManager({workspaceRegistry:{list:()=>[]}}, {storageDir:process.argv[1]});await m.catalog();await new Promise(r=>setTimeout(r,100));if(process.argv[2]==='enable') await m.setEnabled('alpha','global',undefined,true);else await m.setModelInvocable('alpha',false);await m.dispose()`
  await Promise.all(['enable', 'invocation'].map(action => exec(process.execPath, ['--input-type=module', '-e', script, f.storageDir, action])))
  assert.deepEqual((await f.state()).globalEnabled, ['alpha'])
  assert.deepEqual((await f.state()).modelInvocation, { alpha: false })
})

test('F7 persistence failures leave runtime, source bytes, and metadata unchanged', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const before = await f.state()
  const objects = await readdir(join(f.storageDir, 'objects'))
  f.manager.storage.commit = async () => { throw new Error('Injected disk write failure') }
  await assert.rejects(f.manager.setEnabled('alpha', 'global', undefined, true), /disk write/)
  await assert.rejects(f.manager.setModelInvocable('alpha', false), /disk write/)
  await assert.rejects(f.manager.remove('alpha'), /disk write/)
  await writeFile(join(f.source, 'SKILL.md'), markdown('alpha', 'Version two'))
  await assert.rejects(f.manager.update('alpha'), /disk write/)
  assert.deepEqual(await f.state(), before)
  assert.deepEqual(await readdir(join(f.storageDir, 'objects')), objects)
  assert.equal((await f.manager.catalog()).entries[0].globalEnabled, false)
  assert.match(await f.body(), /Safe test skill/)
})

test('F8 direct source paths report current, changed, and deleted without changing installation', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source)
  const status = async () => (await f.manager.checkUpdates('alpha')).entries[0].status
  assert.equal(await status(), 'current')
  await writeFile(join(f.source, 'SKILL.md'), markdown('alpha', 'Modified'))
  assert.equal(await status(), 'update-available')
  await rm(join(f.source, 'SKILL.md'))
  assert.equal(await status(), 'deleted-upstream')
  assert.match(await f.body(), /Safe test skill/)
})

test('source budgets, malformed metadata, duplicates, and unsafe protocols fail closed', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'large'), Buffer.alloc(4 * 1024 * 1024 + 1))
  await assert.rejects(f.manager.install(f.source), /limit/)
  await rm(join(f.source, 'large'))
  await writeFile(join(f.source, 'SKILL.md'), markdown('--global'))
  await assert.rejects(f.manager.install(f.source), /kebab-case/)
  await writeFile(join(f.source, 'SKILL.md'), markdown())
  await mkdir(join(f.source, 'nested'))
  await writeFile(join(f.source, 'nested', 'SKILL.md'), markdown())
  await assert.rejects(f.manager.install(f.source), /Duplicate/)
  for (const url of ['ext::sh -c evil', 'http://example.com/repo', 'ssh://example.com/repo', 'https://token@example.com/repo', 'https://example.com/repo?token=secret']) await assert.rejects(f.manager.installRemote(url))
})

test('storage rejects symbolic-link roots and state files', async t => {
  const f = await fixture(t)
  await mkdir(join(f.root, 'outside'))
  await symlink(join(f.root, 'outside'), f.storageDir)
  await assert.rejects(f.manager.catalog(), /symlink/)
  await rm(f.storageDir)
  await f.manager.catalog()
  const sentinel = join(f.root, 'sentinel')
  await writeFile(sentinel, 'SENTINEL')
  await symlink(sentinel, join(f.storageDir, 'state.json'))
  await assert.rejects(f.manager.catalog())
  assert.equal(await readFile(sentinel, 'utf8'), 'SENTINEL')
})

test('Git updates respect named refs and detect deleted upstream skills', async t => {
  const f = await fixture(t)
  const git = (...args) => exec('git', ['-C', f.source, ...args])
  await git('init'); await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test')
  await git('add', '.'); await git('commit', '-m', 'initial'); await git('branch', 'pinned')
  await writeFile(join(f.source, 'SKILL.md'), markdown('alpha', 'Default branch changed'))
  await git('add', '.'); await git('commit', '-m', 'change default')
  await f.manager.installRemote(pathToFileURL(f.source).href + '#pinned')
  assert.match(await f.body(), /Safe test skill/)
  assert.equal((await f.manager.checkUpdates()).entries[0].status, 'current')
  await git('checkout', 'pinned'); await git('rm', 'SKILL.md'); await git('commit', '-m', 'remove skill')
  assert.equal((await f.manager.checkUpdates()).entries[0].status, 'deleted-upstream')
  await assert.rejects(f.manager.update('alpha'), /deleted or moved/)
  assert.match(await f.body(), /Safe test skill/)
})

test('provider preserves optional discovery and resource metadata', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'SKILL.md'), '---\nname: alpha\ndescription: Metadata fixture\nwhenToUse: Use for metadata checks\nmetadata:\n  category: test\n---\nBody\n')
  await f.manager.install(f.source)
  await f.manager.setEnabled('alpha', 'global', undefined, true)
  const provider = f.manager.provider({ signal: new AbortController().signal, invalidate() {} })
  const [candidate] = (await provider.list({})).candidates
  assert.equal(candidate.whenToUse, 'Use for metadata checks')
  assert.deepEqual(candidate.metadata, { category: 'test' })
  const loaded = await provider.get(candidate, {})
  assert.equal(loaded.resourceBase.kind, 'directory')
  assert.equal(loaded.whenToUse, candidate.whenToUse)
  assert.deepEqual(loaded.metadata, candidate.metadata)
})


test('active manager disposal cancels a Git operation and removes its staging directory', async t => {
  const f = await fixture(t)
  const bin = join(f.root, 'bin')
  const marker = join(f.root, 'started')
  await mkdir(bin)
  await writeFile(join(bin, 'git'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(() => {}, 1000);\n`)
  await chmod(join(bin, 'git'), 0o700)
  const previous = process.env.PATH
  process.env.PATH = bin + ':' + previous
  try {
    const operation = f.manager.installRemote('https://example.invalid/repository')
    const outcome = assert.rejects(operation, /cancelled/)
    for (let i = 0; i < 100; i++) { if (await readFile(marker).catch(() => undefined)) break; await new Promise(resolve => setTimeout(resolve, 10)) }
    assert.equal(await readFile(marker, 'utf8'), 'started')
    await f.manager.dispose()
    await outcome
    assert.deepEqual(await readdir(join(f.storageDir, 'staging')), [])
    await assert.rejects(readFile(join(f.storageDir, 'state.json')), { code: 'ENOENT' })
  } finally { process.env.PATH = previous }
})
