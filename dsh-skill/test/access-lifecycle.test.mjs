import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillAccess from '../lib/access.js'
import { sourceKey } from '../lib/types/access-policy.js'

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'skill-access-upstream-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SkillRegistry)
  ctx.provide('agents', { get() {} })
  let activeScopes = 0
  ctx.provide('agentPresets', { resolve: async () => ({ id: 'test' }), acquireScope: async () => {
    activeScopes++
    return { key: undefined, [Symbol.asyncDispose]: async () => { activeScopes-- } }
  } })
  ctx.provide('sessionQuery', {})
  ctx.provide('workspaceRegistry', { list: () => [{ path: root }] })
  await ctx.plugin(SkillAccess, { policyDir: join(root, 'policy') })
  return { ctx, root, selection: { projectRoot: root, preset: 'test' }, signal: new AbortController().signal, activeScopes: () => activeScopes }
}

test('plugin-owned access denies loads without modifying the official registry', async t => {
  const { ctx, root, selection, signal } = await setup(t)
  ctx.skills.register({ name: 'example', description: 'Example', source: 'runtime', content: 'Instructions' })
  const first = await ctx.skillAccess.inventory(selection, signal)
  assert.equal(first.entries[0].effectiveInvocation.modelInvocable, true)
  await ctx.skillAccess.change(selection, first.policyRevision, { source: first.entries[0].sourceId, scope: { kind: 'global' }, mode: 'off' }, signal)
  const view = await ctx.skillAccess.selection(selection, signal)
  try {
    await assert.rejects(ctx.skillAccess.load('example', view, 'model'), /not available/)
    assert.equal((await ctx.skills.get('example')).content, 'Instructions')
    assert.equal(typeof ctx.skills.registerPolicy, 'undefined')
    await writeFile(join(root, 'policy/policy.json'), '{}')
    await assert.rejects(ctx.skillAccess.load('example', view, 'model'), /Invalid/)
  } finally {
    await view[Symbol.asyncDispose]()
  }
})

test('detail refuses a provider that changes identity while loading instructions', async t => {
  const { ctx, selection, signal } = await setup(t)
  const skill = { name: 'example', description: 'Source A', source: 'custom', provider: 'fixture', rank: 0, locator: 'a', invocation: { modelInvocable: true, userInvocable: true } }
  ctx.skills.registerProvider(() => ({ name: 'fixture', list: async () => [skill], get: async () => ({ ...skill, description: 'Source B', content: 'Body B' }) }))
  const inventory = await ctx.skillAccess.inventory(selection, signal)
  const result = await ctx.skillAccess.detail(selection, inventory.entries[0].sourceId, 'example', signal)
  assert.equal(result.entry.description, 'Source A')
  assert.equal(result.content, null)
})

test('source controls show source policy rather than the last skill override', async t => {
  const { ctx, selection, signal } = await setup(t)
  ctx.skills.register({ name: 'first', description: 'First', source: 'runtime', content: 'First body' })
  ctx.skills.register({ name: 'last', description: 'Last', source: 'runtime', content: 'Last body' })
  const inventory = await ctx.skillAccess.inventory(selection, signal)
  await ctx.skillAccess.change(selection, inventory.policyRevision, { source: inventory.entries[1].sourceId, skill: 'last', scope: { kind: 'global' }, mode: 'off' }, signal)
  const current = await ctx.skillAccess.inventory(selection, signal)
  assert.equal(current.entries.find(entry => entry.name === 'last').access.mode, 'off')
  assert.equal(current.sources[0].mode, 'automatic')
})

test('cold preset reads release their scope after success and failure', async t => {
  const { ctx, selection, signal, activeScopes } = await setup(t)
  ctx.skills.register({ name: 'example', description: 'Example', source: 'runtime', content: 'Body' })
  const inventory = await ctx.skillAccess.inventory(selection, signal)
  assert.equal(activeScopes(), 0)
  await ctx.skillAccess.detail(selection, inventory.entries[0].sourceId, 'example', signal)
  assert.equal(activeScopes(), 0)
  await assert.rejects(ctx.skillAccess.detail(selection, inventory.entries[0].sourceId, 'missing', signal), /no longer discovered/)
  assert.equal(activeScopes(), 0)
})
