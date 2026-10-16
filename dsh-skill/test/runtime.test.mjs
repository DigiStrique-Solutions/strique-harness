import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as OfficialSkillTool from '@deepseek-ai/dsh-tool-skill'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillAccess from '../lib/access.js'
import * as Runtime from '../lib/runtime.js'

class Adapter extends LlmAdapter {
  requests = []
  constructor(script = []) { super(); this.script = script }
  async *stream(request) {
    this.requests.push(request)
    const action = this.script.shift()
    const block = action ? { type: 'tool-call', id: ToolCallId('call-' + this.requests.length), name: 'skill', arguments: JSON.stringify({ name: action }) } : { type: 'text', text: 'Done' }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: action ? 'tool-calls' : 'stop' } }
  }
}
async function setup(t, config = {}, script = []) {
  const root = await mkdtemp(join(tmpdir(), 'skills-runtime-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SkillRegistry)
  ctx.provide('agentPresets', { serviceFor: () => undefined, acquireScope: async () => ({ key: undefined, [Symbol.asyncDispose]: async () => undefined }), composedPreset: () => undefined, composeFrom: () => undefined })
  ctx.provide('sessionQuery', {})
  ctx.provide('workspaceRegistry', { list: () => [] })
  const access = ctx.plugin(SkillAccess, { policyDir: root }); await access
  const runtime = ctx.plugin(Runtime, config); await runtime
  const driver = await mountAgentLoopTestHarness(ctx)
  const adapter = new Adapter(script); ctx.llm.registerAdapter(['test'], adapter)
  const agent = await driver.create(SessionId('parent'), { provider: 'test', model: 'fixture' })
  const turn = async (text = 'Use a matching skill') => { agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle() }
  return { ctx, agent, adapter, driver, turn, access, runtime }
}

test('official core receives complete summaries before parent and child requests and bodies only after loading', async t => {
  const { ctx, agent, adapter, turn } = await setup(t, {}, ['fixture'])
  let attempts = 0
  const skill = { name: 'fixture', description: 'CATALOG_FIXTURE', source: 'custom', provider: 'slow', rank: 0, locator: 'fixture', invocation: { modelInvocable: true, userInvocable: true } }
  ctx.skills.registerProvider(() => ({ name: 'slow', list: async () => ({ complete: ++attempts > 1, candidates: attempts > 1 ? [skill] : [] }), get: async () => ({ ...skill, content: 'PRIVATE_SKILL_BODY' }) }))
  await turn()
  assert.equal(adapter.requests.length, 2)
  assert.match(JSON.stringify(adapter.requests[0].messages), /CATALOG_FIXTURE/)
  assert.doesNotMatch(JSON.stringify(adapter.requests[0].messages), /PRIVATE_SKILL_BODY/)
  assert.match(JSON.stringify(adapter.requests[1].messages), /PRIVATE_SKILL_BODY/)
  await ctx.plugin(SubagentRuntime); await ctx.plugin(Spawn, { providerName: 'spawn' })
  const child = await ctx.subagents.startActivation({ provider: 'spawn', label: 'skills fixture', delivery: 'caller', request: { parent: agent, prompt: [{ type: 'text', text: 'Use available skills' }] }, signal: new AbortController().signal })
  try { assert.equal((await child.result).stopReason, 'completed') } finally { await child.dispose() }
  assert.match(JSON.stringify(adapter.requests[2].messages), /CATALOG_FIXTURE/)
  assert.doesNotMatch(JSON.stringify(adapter.requests[2].messages), /PRIVATE_SKILL_BODY/)
})

test('incomplete discovery reaches its deadline without sending a model request', async t => {
  const { ctx, adapter, turn } = await setup(t, { initialDiscoveryTimeoutMs: 30 })
  ctx.skills.registerProvider(() => ({ name: 'unready', list: async () => ({ complete: false, candidates: [] }), get: async () => undefined }))
  await turn()
  assert.equal(adapter.requests.length, 0)
})

test('a complete empty catalog is valid and does not delay model dispatch', async t => {
  const { adapter, turn } = await setup(t)
  await turn()
  assert.equal(adapter.requests.length, 1)
  assert.match(JSON.stringify(adapter.requests[0].messages), /managed-skill-catalog/)
})

test('manual-only skills load on an explicit user gesture and remain hidden from model catalogs', async t => {
  const { ctx, adapter, turn } = await setup(t)
  ctx.skills.register({ name: 'manual', description: 'MANUAL_SUMMARY', source: 'runtime', invocation: { modelInvocable: false, userInvocable: true }, content: 'MANUAL_BODY' })
  await turn('Please use /manual')
  assert.match(JSON.stringify(adapter.requests[0].messages), /MANUAL_BODY/)
  const catalogs = adapter.requests[0].messages.filter(message => message.source?.kind === 'managed-skill-catalog')
  assert.doesNotMatch(JSON.stringify(catalogs), /MANUAL_SUMMARY/)
})

test('off rules prevent guessed model loads and explicit user loads', async t => {
  const { ctx, adapter, agent, turn } = await setup(t, {}, ['blocked'])
  ctx.skills.register({ name: 'blocked', description: 'BLOCKED_SUMMARY', source: 'runtime', content: 'BLOCKED_BODY' })
  const view = ctx.skillAccess.runtimeView(agent, new AbortController().signal)
  const snapshot = await ctx.skillAccess.snapshot(view)
  await ctx.skillAccess.store.change(snapshot.policyRevision, [{ source: snapshot.entries[0].sourceId, scope: { kind: 'global' }, mode: 'off' }])
  await turn('/blocked')
  assert.equal(adapter.requests.length, 2)
  assert.doesNotMatch(JSON.stringify(adapter.requests), /BLOCKED_BODY|BLOCKED_SUMMARY/)
})

test('policy withdrawal denies dispatch and restoration keeps exactly one runtime', async t => {
  const { ctx, agent, access, turn, adapter } = await setup(t)
  assert.ok(ctx.tools.get('skill', agent))
  await access.dispose()
  await turn()
  assert.equal(adapter.requests.length, 0)
  assert.ok(ctx.tools.get('skill', agent))
  await ctx.plugin(SkillAccess, { policyDir: access.config.policyDir })
  // Required-service activation is awaited through the dependent fiber.
  await turn()
  assert.ok(ctx.tools.get('skill', agent))
  assert.equal(adapter.requests[0].tools.filter(tool => tool.name === 'skill').length, 1)
})


test('preset skill tools cannot bypass plugin catalogs or manual access rules', async t => {
  const { ctx, agent, adapter, turn } = await setup(t, {}, ['blocked'])
  // The same scope precedence as a standard preset: the official tool shadows
  // the Host tool. Mount before the first pre-step, as a preset does.
  const presetKey = {}
  const { bindScopeParent } = await import('@deepseek-ai/dsh-scope')
  bindScopeParent(agent, presetKey)
  const preset = createScope(ctx, presetKey)
  await preset.ctx.plugin(OfficialSkillTool)
  ctx.skills.register({ name: 'blocked', description: 'BLOCKED_SUMMARY', source: 'runtime', content: 'BLOCKED_BODY' })
  const view = ctx.skillAccess.runtimeView(agent, new AbortController().signal)
  const snapshot = await ctx.skillAccess.snapshot(view)
  await ctx.skillAccess.store.change(snapshot.policyRevision, [{ source: snapshot.entries[0].sourceId, scope: { kind: 'global' }, mode: 'off' }])
  await turn('/blocked')
  assert.equal(adapter.requests.length, 2)
  assert.doesNotMatch(JSON.stringify(adapter.requests), /BLOCKED_BODY|BLOCKED_SUMMARY/)
  assert.match(JSON.stringify(adapter.requests[0].messages), /managed-skill-catalog/)
})

test('disposing the runtime cancels initial discovery before any model request', async t => {
  const { ctx, agent, runtime, adapter } = await setup(t, { initialDiscoveryTimeoutMs: 10000 })
  let started
  const discovery = new Promise(resolve => { started = resolve })
  ctx.skills.registerProvider(() => ({ name: 'blocked-discovery', list: async options => { started(); return { complete: false, candidates: [] } }, get: async () => undefined }))
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'fixture' }] }))
  await discovery
  await runtime.dispose()
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 0)
  assert.equal(ctx.tools.get('skill', agent), undefined)
})

test('a changed catalog reaches the next turn and context after replay', async t => {
  const { ctx, agent, adapter, turn } = await setup(t)
  const remove = ctx.skills.register({ name: 'first', description: 'FIRST_SUMMARY', source: 'runtime', content: 'FIRST_BODY' })
  await turn()
  remove()
  ctx.skills.register({ name: 'second', description: 'SECOND_SUMMARY', source: 'runtime', content: 'SECOND_BODY' })
  await turn()
  const catalogs = adapter.requests[1].messages.filter(message => message.source.kind === 'managed-skill-catalog')
  assert.deepEqual(catalogs.at(-1).source.entries.map(entry => entry.name), ['second'])
  const { projectContext } = await import('../lib/types/context.js')
  const restored = JSON.parse(JSON.stringify(agent.session.snapshotEvents()))
  assert.deepEqual(projectContext(restored).summaries.map(entry => entry.name), ['second'])
})

test('a rule for a removed unrelated preset cannot block another agent', async t => {
  const { ctx, agent, adapter, turn } = await setup(t)
  ctx.skills.register({ name: 'fixture', description: 'SUMMARY', source: 'runtime', content: 'BODY' })
  const view = ctx.skillAccess.runtimeView(agent, new AbortController().signal)
  const snapshot = await ctx.skillAccess.snapshot(view)
  await ctx.skillAccess.store.change(snapshot.policyRevision, [{ source: snapshot.entries[0].sourceId, scope: { kind: 'preset', value: 'removed-preset' }, mode: 'off' }])
  ctx.agentPresets.acquireScope = async () => { throw new Error('Preset no longer exists') }
  await turn()
  assert.equal(adapter.requests.length, 1)
  assert.match(JSON.stringify(adapter.requests[0].messages), /SUMMARY/)
})

test('the actual composed preset applies its own restriction before dispatch', async t => {
  const { ctx, agent, adapter, turn } = await setup(t, {}, ['fixture'])
  ctx.agentPresets.composedPreset = () => 'restricted'
  ctx.skills.register({ name: 'fixture', description: 'HIDDEN_SUMMARY', source: 'runtime', content: 'HIDDEN_BODY' })
  const view = ctx.skillAccess.runtimeView(agent, new AbortController().signal)
  const snapshot = await ctx.skillAccess.snapshot(view)
  await ctx.skillAccess.store.change(snapshot.policyRevision, [{ source: snapshot.entries[0].sourceId, scope: { kind: 'preset', value: 'restricted' }, mode: 'off' }])
  await turn('/fixture')
  assert.equal(adapter.requests.length, 2)
  assert.doesNotMatch(JSON.stringify(adapter.requests), /HIDDEN_BODY|HIDDEN_SUMMARY/)
})
