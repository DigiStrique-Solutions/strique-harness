import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PolicyStore, sourceKey, decideAccess } from '../lib/types/access-policy.js'

const skill = { name: 'composio-cli', provider: 'filesystem', source: 'user-agents', sourceIdentity: { origin: '/shared/skills', location: '/shared/skills/composio-cli/SKILL.md' }, invocation: { userInvocable: true, modelInvocable: true } }
test('source admission blocks overrides, while admitted defaults permit explicit skill overrides', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skill-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new PolicyStore(root)
  await store.init()
  let state = await store.read()
  assert.equal(decideAccess(state, skill, {}).mode, 'automatic')
  assert.equal(decideAccess(state, skill, {}).recorded, false)
  const source = sourceKey(skill)
  state = await store.change(0, [{ source, mode: 'off', scope: { kind: 'global' } }])
  state = await store.change(1, [{ source, skill: skill.name, mode: 'automatic', scope: { kind: 'global' } }])
  assert.equal(decideAccess(state, skill, {}).mode, 'off')
  state = await store.change(2, [{ source, mode: 'automatic', scope: { kind: 'global' } }, { source, skill: skill.name, mode: 'manual', scope: { kind: 'workspace', value: '/work' } }])
  assert.equal(decideAccess(state, skill, { cwd: '/work' }).mode, 'manual')
  assert.equal(decideAccess(state, skill, { cwd: '/elsewhere' }).mode, 'automatic')
  await assert.rejects(store.change(2, []), /changed/)
  state = await store.change(3, [{ source, mode: 'manual', scope: { kind: 'global' } }])
  assert.equal(decideAccess(state, skill, {}).mode, 'automatic', 'explicit skill rule overrides an admitted source default')
  assert.equal(decideAccess(state, skill, { cwd: '/work' }).mode, 'manual', 'narrower restriction still applies')
  const restarted = new PolicyStore(root)
  await restarted.init()
  assert.deepEqual(await restarted.read(), state)
  assert.notEqual(sourceKey({ ...skill, sourceIdentity: { origin: '/replacement' } }), source)
  await writeFile(join(root, 'policy.json'), '{}')
  await assert.rejects(store.read(), /Invalid/)
})

test('deleting an initialized policy file fails closed across restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skill-policy-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new PolicyStore(root)
  await store.init()
  await store.change(0, [{ source: sourceKey(skill), mode: 'off', scope: { kind: 'global' } }])
  await rm(join(root, 'policy.json'))
  await assert.rejects(new PolicyStore(root).init(), /missing|ENOENT/)
})

test('saved rules from the core extension cannot silently grant access after switching identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skill-policy-upgrade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new PolicyStore(root)
  await store.init()
  const old = { version: 1, revision: 2, migrated: false, rules: [{ source: sourceKey(skill), scope: { kind: 'global' }, mode: 'off', at: new Date().toISOString(), action: 'explicit' }] }
  await writeFile(join(root, 'policy.json'), JSON.stringify(old))
  const state = await store.read()
  assert.equal(decideAccess(state, { ...skill, sourceIdentity: { origin: 'new-public-identity' } }, {}).mode, 'off')
  await assert.rejects(store.change(2, []), /review/)
  await store.change(2, [{ source: sourceKey(skill), scope: { kind: 'global' }, mode: 'off' }], undefined, true)
  assert.equal((await store.read()).needsReview, false)
})
