import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as persona from '../src/persona.js'

const prompt = readFileSync(new URL('../prompts/strique.md', import.meta.url), 'utf8').trim()
let ctx: Context

afterEach(async () => { await ctx?.fiber.dispose() })

async function bench() {
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { personaPrefix: 'Global coding persona', personaSuffix: 'Global suffix' },
  })
  await mountAgentLoopTestHarness(ctx)
  ctx.systemPrompt.section({ name: 'harness:source', order: 150, text: 'Implementation checkout: /fixture/harness' })
  ctx.systemPrompt.section({ name: 'app:web-surface', order: 160, text: 'Develop the Harness GUI at http://localhost:9999 using pnpm run dev:web.' })
  ctx.systemPrompt.section({ name: 'tools:procedure', order: 100, text: 'Keep renderer syntax and tool procedures.' })
  ctx.systemPrompt.context({ name: 'account', order: 0, text: 'Selected account: example' })
  ctx.systemPrompt.tools(() => ({ schemas: [{ name: 'lookup', description: 'Read a report', parameters: { type: 'object' } }] }))
  return ctx
}

async function create(id: string, meta?: CreateAgentOptions['meta'], complete = false) {
  const { agent } = await ctx.agents.create({
    sessionId: SessionId(id),
    ...(meta === undefined ? {} : { meta }),
    setup(agentCtx) {
      agentCtx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION, order: 0, text: `Preset for ${id}`, complete,
      })
      agentCtx.systemPrompt.variable('cwd', () => '/synthetic-workspace')
      agentCtx.systemPrompt.section({ name: 'deployment:persona-suffix', order: 200, text: 'Working directory: {{cwd}}' })
    },
  })
  return agent
}

describe('Strique persona in real Harness assemblies', () => {
  it('replaces product identity and development guidance while preserving operational inputs and existing sessions', async () => {
    await bench()
    const agent = await create('root')
    const before = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    const fiber = await ctx.plugin(persona)
    const after = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(renderPrompt(before)).toContain('DeepSeek Harness')
    expect(renderPrompt(after).startsWith(prompt)).toBe(true)
    expect(renderPrompt(after)).not.toContain('DeepSeek Harness')
    expect(renderPrompt(after)).not.toContain('/fixture/harness')
    expect(renderPrompt(after)).not.toContain('pnpm run dev:web')
    expect(after.sections.find(section => section.name === 'app:web-surface')?.text).toContain('Strique')
    const productSections = new Set([PERSONA_PREFIX_SECTION, 'harness:identity', 'harness:source', 'app:web-surface'])
    expect(after.sections.filter(section => !productSections.has(section.name)))
      .toEqual(before.sections.filter(section => !productSections.has(section.name)))
    expect({ ...after, sections: [] }).toEqual({ ...before, sections: [] })
    expect(renderPrompt(after)).toContain('Working directory: /synthetic-workspace')
    expect(renderPrompt(after)).not.toContain('Preset for root')
    expect(after.sections.filter(section => section.text === prompt)).toHaveLength(1)
    await fiber.dispose()
    expect(await ctx.systemPrompt.assemble(assembleContextFor(agent))).toEqual(before)
    for (let cycle = 0; cycle < 2; cycle++) {
      const reloaded = await ctx.plugin(persona)
      expect(await ctx.systemPrompt.assemble(assembleContextFor(agent))).toEqual(after)
      await reloaded.dispose()
      expect(await ctx.systemPrompt.assemble(assembleContextFor(agent))).toEqual(before)
    }
  })

  it('preserves delegated roles and complete overrides while branding ordinary forks', async () => {
    await bench()
    const root = await create('root')
    const fork = await create('fork', { parentSession: root.session.id, delegationDepth: 0 })
    const depthChild = await create('depth-child', { delegationDepth: 1 })
    const legacyChild = await create('origin-child', { origin: 'subagent' })
    const complete = await create('complete', undefined, true)
    const agents = [root, fork, depthChild, legacyChild, complete]
    const before = await Promise.all(agents.map(agent => ctx.systemPrompt.assemble(assembleContextFor(agent))))
    const preview = await ctx.systemPrompt.assemble()
    await ctx.plugin(persona)
    const after = await Promise.all(agents.map(agent => ctx.systemPrompt.assemble(assembleContextFor(agent))))
    expect(renderPrompt(after[0]!)).toContain(prompt)
    expect(renderPrompt(after[1]!)).toContain(prompt)
    expect(after.slice(2)).toEqual(before.slice(2))
    expect(renderPrompt(after[4]!)).toBe('Preset for complete')
    expect(await ctx.systemPrompt.assemble()).toEqual(preview)
  })

  it('cooperates with later assembly middleware and respects complete runtime-context suppression', async () => {
    await bench()
    await ctx.plugin(persona)
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: [...assembly.sections, { name: 'planning', text: 'Plan only.' }] }
    })
    const agent = await create('planning-root')
    expect(renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))).toContain('Plan only.')
    const complete = await create('complete-no-context', undefined, true)
    complete.ctx.systemPrompt.suppressRuntimeContext()
    const result = await ctx.systemPrompt.assemble(assembleContextFor(complete))
    expect(result.contexts).toEqual([])
    expect(renderPrompt(result)).toBe('Preset for complete-no-context')
  })

  it('waits for its provider and withdraws and restores its listener with the provider', async () => {
    ctx = new Context()
    const consumer = ctx.plugin(persona)
    expect(consumer.state).toBe(0)
    const provider = await ctx.plugin(SystemPrompt, {})
    await consumer.await()
    expect(consumer.state).toBe(2)
    await provider.dispose()
    expect(consumer.state).toBe(0)
    await ctx.plugin(SystemPrompt, {})
    await consumer.await()
    expect(consumer.state).toBe(2)
  })
})
