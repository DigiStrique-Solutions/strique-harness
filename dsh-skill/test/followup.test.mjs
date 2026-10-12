import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { SkillManager } from '../lib/index.js'

const host = { workspaceRegistry: { list: () => [] }, get: () => undefined, logger: { warn() {} } }
const markdown = (name = 'alpha') => `---\nname: ${name}\ndescription: Regression fixture\n---\nRead assets/inside.txt and ../../shared/outside.txt.\n`
async function fixture(t, name = 'alpha', config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-followup-'))
  const source = join(root, 'source')
  const skill = join(source, 'skills', name)
  const storageDir = join(root, 'storage')
  await mkdir(join(skill, 'assets'), { recursive: true })
  await mkdir(join(source, 'shared'))
  await writeFile(join(skill, 'SKILL.md'), markdown(name))
  await writeFile(join(skill, 'assets', 'inside.txt'), 'inside-one')
  await writeFile(join(source, 'shared', 'outside.txt'), 'shared-one')
  const manager = new SkillManager(host, { storageDir, ...config })
  t.after(async () => { await manager.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, source, skill, storageDir, manager }
}
async function loaded(manager, name = 'alpha') {
  const controller = new AbortController()
  const provider = manager.provider({ signal: controller.signal, invalidate() {} })
  try { return await provider.get((await provider.list({})).candidates.find(item => item.name === name), {}) }
  finally { controller.abort() }
}

test('constructor is an ordinary skill name across import, policy, update and removal', async t => {
  const { manager, source } = await fixture(t, 'constructor')
  for (const action of [() => manager.setEnabled('constructor', 'global', undefined, true), () => manager.setModelInvocable('constructor', false), () => manager.update('constructor'), () => manager.remove('constructor')]) {
    await assert.rejects(action(), /not installed/)
  }
  const imported = await manager.install(source)
  assert.equal(imported.entries[0].modelInvocable, true)
  await manager.setEnabled('constructor', 'global', undefined, true)
  assert.equal((await loaded(manager, 'constructor')).invocation.modelInvocable, true)
  await manager.setModelInvocable('constructor', false)
  assert.equal((await loaded(manager, 'constructor')).invocation.modelInvocable, false)
  await manager.update('constructor')
  assert.deepEqual((await manager.remove('constructor')).entries, [])
})

test('import and update preserve shared resources and detect shared-only changes', async t => {
  const { manager, source } = await fixture(t)
  await manager.install(source, ['alpha'])
  await manager.setEnabled('alpha', 'global', undefined, true)
  const first = await loaded(manager)
  assert.equal(await readFile(resolve(first.resourceBase.path, '../../shared/outside.txt'), 'utf8'), 'shared-one')
  await writeFile(join(source, 'shared', 'outside.txt'), 'shared-two')
  assert.equal((await manager.checkUpdates('alpha')).entries[0].status, 'update-available')
  await manager.update('alpha')
  const second = await loaded(manager)
  assert.equal(await readFile(resolve(second.resourceBase.path, '../../shared/outside.txt'), 'utf8'), 'shared-two')
  assert.equal((await manager.checkUpdates('alpha')).entries[0].status, 'current')
})

test('previously loaded assets survive update, removal and manager restart', async t => {
  const { manager, source, skill, storageDir } = await fixture(t)
  await manager.install(source)
  await manager.setEnabled('alpha', 'global', undefined, true)
  const first = await loaded(manager)
  await writeFile(join(skill, 'assets', 'inside.txt'), 'inside-two')
  await manager.update('alpha')
  const second = await loaded(manager)
  assert.equal(await readFile(join(first.resourceBase.path, 'assets', 'inside.txt'), 'utf8'), 'inside-one')
  await manager.remove('alpha')
  await manager.dispose()
  const restarted = new SkillManager(host, { storageDir })
  try {
    assert.deepEqual((await restarted.catalog()).entries, [])
    assert.equal(await readFile(join(first.resourceBase.path, 'assets', 'inside.txt'), 'utf8'), 'inside-one')
    assert.equal(await readFile(join(second.resourceBase.path, 'assets', 'inside.txt'), 'utf8'), 'inside-two')
  } finally { await restarted.dispose() }
})

test('retention budget rejects an update without deleting or replacing published resources', async t => {
  const { manager, source, skill } = await fixture(t, 'alpha', { maxStorageBytes: 1024 })
  await manager.install(source)
  await manager.setEnabled('alpha', 'global', undefined, true)
  const first = await loaded(manager)
  await writeFile(join(skill, 'assets', 'inside.txt'), 'x'.repeat(1024))
  await assert.rejects(manager.update('alpha'), /Retained storage limit/)
  assert.equal((await loaded(manager)).resourceBase.path, first.resourceBase.path)
  assert.equal(await readFile(join(first.resourceBase.path, 'assets', 'inside.txt'), 'utf8'), 'inside-one')
})

test('committed imports succeed despite cleanup errors and the next mutation recovers', async () => {
  for (const target of ['lock', 'staging']) {
    await promisify(execFile)(process.execPath, [new URL('./fixtures/cleanup-fault.mjs', import.meta.url).pathname, target], { timeout: 10_000 })
  }
})

test('inspection identifies invalid entries while valid selections remain importable', async t => {
  const { manager, source } = await fixture(t)
  await mkdir(join(source, 'examples'))
  await writeFile(join(source, 'examples', 'SKILL.md'), '# Unfinished example\n')
  const inspected = await manager.inspect(source)
  assert.deepEqual(inspected.entries.map(entry => entry.name), ['alpha'])
  assert.deepEqual(inspected.diagnostics, [{ path: 'examples/SKILL.md', message: 'SKILL.md requires YAML frontmatter' }])
  assert.equal((await manager.install(source, ['alpha'], undefined, undefined, inspected.snapshot)).entries[0].name, 'alpha')
  await assert.rejects(manager.install(source, ['examples']), /unknown skill/)
})

test('duplicate names are diagnosed and cannot be selected while unrelated skills can', async t => {
  const { manager, source } = await fixture(t)
  for (const dir of ['one', 'two']) {
    await mkdir(join(source, dir))
    await writeFile(join(source, dir, 'SKILL.md'), markdown('duplicate'))
  }
  const inspected = await manager.inspect(source)
  assert.deepEqual(inspected.entries.map(entry => entry.name), ['alpha'])
  assert.deepEqual(inspected.diagnostics.map(item => item.path), ['one/SKILL.md', 'two/SKILL.md'])
  await assert.rejects(manager.install(source, ['duplicate']), /unknown skill/)
  assert.equal((await manager.install(source, ['alpha'])).entries[0].name, 'alpha')
})

test('invalid upstream metadata is reported as unknown and preserves the installed version', async t => {
  const { manager, source, skill } = await fixture(t)
  await manager.install(source)
  await manager.setEnabled('alpha', 'global', undefined, true)
  const first = await loaded(manager)
  await writeFile(join(skill, 'SKILL.md'), '# Broken metadata\n')
  assert.equal((await manager.checkUpdates('alpha')).entries[0].status, 'unknown')
  await assert.rejects(manager.update('alpha'), /cannot be updated.*frontmatter/)
  assert.equal((await loaded(manager)).resourceBase.path, first.resourceBase.path)
})

test('unresolved Git LFS assets are rejected before import', async t => {
  const { manager, source, skill } = await fixture(t)
  await writeFile(join(skill, 'assets', 'image.png'), 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 100\n')
  await assert.rejects(manager.inspect(source), /Git LFS.*materialize/)
  await assert.rejects(manager.install(source), /Git LFS.*materialize/)
  assert.deepEqual((await manager.catalog()).entries, [])
})

test('Git submodule sources are rejected with an export instruction', async t => {
  const { manager, source } = await fixture(t)
  await writeFile(join(source, '.gitmodules'), '[submodule "shared"]\n path = shared\n url = https://example.invalid/shared.git\n')
  const git = (...args) => promisify(execFile)('git', ['-C', source, ...args])
  await git('init')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Test')
  await git('add', '.')
  await git('commit', '-m', 'Fixture')
  await assert.rejects(manager.installRemote(pathToFileURL(source).href), /submodules.*local export/)
  assert.deepEqual((await manager.catalog()).entries, [])
})

test('legacy subtree installations stay readable and are offered a layout upgrade', async t => {
  const { manager, source, skill, storageDir } = await fixture(t)
  // Public 0.2.0 on-disk format, representing an existing installed library.
  const object = '11111111-1111-1111-1111-111111111111'
  const oldRoot = join(storageDir, 'objects', object)
  await mkdir(oldRoot, { recursive: true })
  await writeFile(join(oldRoot, 'SKILL.md'), markdown())
  // Use a content-only skill so the legacy hash has a literal, independently reproducible input.
  await rm(join(skill, 'assets'), { recursive: true })
  const oldHash = createHash('sha256').update(JSON.stringify(['SKILL.md', 0, Buffer.byteLength(markdown())])).update(markdown()).digest('hex')
  await writeFile(join(storageDir, 'state.json'), JSON.stringify({ version: 1, globalEnabled: ['alpha'], projectEnabled: {}, modelInvocation: {}, installs: { alpha: { source, sourceType: 'local', object, relativePath: 'skills/alpha', hash: oldHash, description: 'Regression fixture', modelInvocable: true, userInvocable: true } } }))
  const before = await loaded(manager)
  assert.equal(before.resourceBase.path, oldRoot)
  assert.equal((await manager.checkUpdates('alpha')).entries[0].status, 'update-available')
  await manager.update('alpha')
  assert.equal(await readFile(resolve((await loaded(manager)).resourceBase.path, '../../shared/outside.txt'), 'utf8'), 'shared-one')
  assert.equal(await readFile(join(oldRoot, 'SKILL.md'), 'utf8'), markdown())
})

test('shared empty directory changes also invalidate the source snapshot', async t => {
  const { manager, source } = await fixture(t)
  await manager.install(source)
  await mkdir(join(source, 'shared/empty'))
  assert.equal((await manager.checkUpdates('alpha')).entries[0].status, 'update-available')
})

test('updates a shared repository once within quota and reuses the published snapshot', async t => {
  const { manager, source, storageDir } = await fixture(t, 'alpha', { maxStorageBytes: 700 })
  await mkdir(join(source, 'skills/beta'))
  await writeFile(join(source, 'skills/beta/SKILL.md'), markdown('beta'))
  await manager.install(source)
  await writeFile(join(source, 'shared/outside.txt'), 'shared-two')
  const result = await manager.updateMany(['alpha', 'beta'])
  assert.deepEqual(result.results, [{ names: ['alpha', 'beta'], ok: true }])
  const state = JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  assert.equal(state.installs.alpha.object, state.installs.beta.object)
  await manager.update('alpha')
  await manager.update('beta')
  const after = JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  assert.equal(after.installs.alpha.object, state.installs.alpha.object)
  assert.equal(after.installs.beta.object, state.installs.beta.object)
})

test('batch failures preserve the whole source group and report independent successes', async t => {
  const { manager, source, storageDir, root } = await fixture(t)
  await mkdir(join(source, 'skills/beta'))
  await writeFile(join(source, 'skills/beta/SKILL.md'), markdown('beta'))
  await manager.install(source)
  const other = join(root, 'other')
  await mkdir(other)
  await writeFile(join(other, 'SKILL.md'), markdown('gamma'))
  await manager.install(other)
  const before = JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  await writeFile(join(source, 'skills/beta/SKILL.md'), '# Invalid')
  await writeFile(join(source, 'shared/outside.txt'), 'modified')
  await writeFile(join(other, 'SKILL.md'), markdown('gamma') + 'New content')
  const report = await manager.updateMany(['alpha', 'beta', 'gamma'])
  assert.deepEqual(report.results.map(result => [result.names, result.ok]), [[['alpha', 'beta'], false], [['gamma'], true]])
  const after = JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  assert.deepEqual(after.installs.alpha, before.installs.alpha)
  assert.deepEqual(after.installs.beta, before.installs.beta)
  assert.notEqual(after.installs.gamma.object, before.installs.gamma.object)
})
