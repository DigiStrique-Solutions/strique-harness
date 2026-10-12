import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SourceIdentity } from './skill-view.js'
import type {} from './access-service.js'

export const name = 'dsh-skills-runtime'
export const inject = ['skills', 'tools', 'agents']
export interface Config { initialDiscoveryTimeoutMs?: number }
export const Config = Schema.object({ initialDiscoveryTimeoutMs: Schema.number().min(1).max(120000).step(1).default(10000) })
interface CatalogSource { kind: 'managed-skill-catalog'; form: 'catalog'; entries: { name: string; description: string }[]; discovery: { complete: true; revision: string } }
interface InvocationSource { kind: 'managed-skill-invocation'; form: 'instructions'; name: string; sourceIdentity?: SourceIdentity }
declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'managed-skill-catalog': CatalogSource; 'managed-skill-invocation': InvocationSource } }

/** Plugin-owned model and user skill entrypoints; the upstream registry is never replaced. */
export function apply(ctx: Context, config: Config = {}): void {
  const timeout = config.initialDiscoveryTimeoutMs ?? 10000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('Invalid initialDiscoveryTimeoutMs')
  const lifetime = new AbortController()
  const operations = new Set<Promise<unknown>>()
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...operations]) }, 'managed skill requests')
  const run = <T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const combined = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(timeout)])
    const result = work(combined)
    operations.add(result)
    void result.finally(() => operations.delete(result)).catch(() => undefined)
    return result
  }
  const access = () => {
    const value = ctx.get('skillAccess')
    if (!value) throw new Error('Skill access service is unavailable')
    return value
  }
  const tool = defineTool({
    name: 'skill',
    description: 'Load full instructions for an available skill by its exact catalog name before performing that task.',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', required: true }, provider: { type: 'string', required: true }, content: { type: 'string', required: true },
        sourceIdentity: { type: 'object', additionalProperties: false, properties: { origin: { type: 'string', required: true }, location: { type: 'string' }, version: { type: 'string' } } },
      } },
      render: (_args, value) => [{ type: 'text', text: value.content }],
      presentationMeta: (_args, value) => ({ skillSourceIdentity: value.sourceIdentity ?? null }),
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('Skill loading requires an agent scope')
      return run(exec.signal, async signal => {
        const skill = await access().load(args.name, access().runtimeView(exec.agent!, signal), 'model')
        signal.throwIfAborted()
        return { name: skill.name, provider: skill.provider, content: renderSkillContent(skill), ...(skill.sourceIdentity ? { sourceIdentity: skill.sourceIdentity } : {}) }
      })
    },
  })
  ctx.tools.register(tool)
  const scopes = new Map<Agent, Scope>()
  const attach = (agent: Agent) => {
    if (scopes.has(agent) || !ctx.tools.get('skill', agent)) return
    const scope = createScope(ctx, agent)
    try { scope.ctx.tools.register(tool); scopes.set(agent, scope) }
    catch (error) { void scope.dispose(); throw error }
  }
  ctx.on('agent/created', ({ agent }) => { attach(agent); return undefined })
  ctx.on('agent/disposed', async ({ agent }) => { const scope = scopes.get(agent); scopes.delete(agent); await scope?.dispose() })
  for (const agent of ctx.agents.list()) attach(agent)
  ctx.effect(() => async () => { await Promise.all([...scopes.values()].map(scope => scope.dispose())); scopes.clear() }, 'managed skill scopes')
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    attach(agent)
    if (ctx.tools.get('skill', agent) !== tool) return next()
    access()
    const decision = await next()
    if (decision.kind === 'reject' || ctx.tools.get('skill', agent) !== tool) return decision
    return run(signal, async signal => {
      const view = access().runtimeView(agent, signal)
      let snapshot = await access().snapshot(view)
      while (!snapshot.complete) {
        await delay(25, undefined, { signal })
        snapshot = await access().snapshot(view)
      }
      signal.throwIfAborted()
      const entries = snapshot.entries.filter(entry => entry.status === 'winner' && entry.effectiveInvocation.modelInvocable)
        .map(entry => ({ name: entry.name, description: entry.description.replace(/\s+/g, ' ').trim().slice(0, 500) }))
      const revision = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
      const previous = [...agent.session.surface.nodes].reverse().map(seq => agent.session.eventAt(seq)).find(event => event?.type === 'user/message' && event.data.source.kind === 'managed-skill-catalog')
      const injected = []
      if (previous?.type !== 'user/message' || previous.data.source.kind !== 'managed-skill-catalog' || previous.data.source.discovery.revision !== revision) {
        injected.push(createUserMessage({ source: { kind: 'managed-skill-catalog', form: 'catalog', entries, discovery: { complete: true, revision } },
          content: [{ type: 'text', text: ['Current available skills (summaries only). This catalog replaces earlier skill catalogs.',
            'When a task names or matches a skill, call the skill tool before acting. Load full instructions only as needed. Explicit /skill-name invocations already include instructions.',
            '<available_skills>', ...entries.map(entry => `- ${entry.name}: ${escapeText(entry.description)}`), '</available_skills>'].join('\n') }] }))
      }
      const requested = new Set<string>()
      for (const message of messages) if (message.source.kind === 'user') for (const block of message.content) if (block.type === 'text') {
        for (const match of block.text.matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)) requested.add(match[1])
      }
      for (const name of requested) {
        const entry = snapshot.entries.find(entry => entry.name === name && entry.status === 'winner')
        if (!entry?.effectiveInvocation.userInvocable) continue
        const skill = await access().load(name, view, 'user')
        injected.push(createUserMessage({ source: { kind: 'managed-skill-invocation', form: 'instructions', name, ...(skill.sourceIdentity ? { sourceIdentity: skill.sourceIdentity } : {}) }, content: [{ type: 'text', text: renderSkillContent(skill) }] }))
      }
      signal.throwIfAborted()
      return { ...decision, messages: [...decision.messages.filter(message => String(message.source.kind) !== 'skill-catalog' && message.source.kind !== 'skill-invocation'), ...injected] }
    })
  }, { prepend: true })
}
