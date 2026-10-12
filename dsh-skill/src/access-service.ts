import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import { join, isAbsolute, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { observeSkill, definitionKey, type ObservedSkill } from './skill-view.js'
import type {} from './index.js'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { projectContext } from './context.js'
import { PolicyStore, sourceKey, decideAccess, sharedSource, validateRule, type AccessMode, type AccessRuleInput } from './access-policy.js'

export interface Selection { sessionId?: string; projectRoot?: string; preset?: string }
export interface Config { policyDir?: string }
export const POLICY_NAME = 'dsh-skills-access'

/** Host-owned registry view and policy. Presentation can disappear without withdrawing this service. */
export class SkillAccess extends Service {
  static inject = ['skills', 'agents', 'agentPresets', 'sessionQuery', 'workspaceRegistry']
  static Config = Schema.object({ policyDir: Schema.string().default('') })
  readonly store: PolicyStore
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillAccess')
    if (config.policyDir && !isAbsolute(config.policyDir)) throw new Error('policyDir must be absolute')
    this.store = new PolicyStore(config.policyDir || join(resolveDshHome(), 'skills-access'))
    ctx.effect(() => async () => { this.lifetime.abort(); await Promise.allSettled([...this.operations]) }, 'skill access lifetime')
  }
  private run<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(30_000)])
    const operation = (async () => { combined.throwIfAborted(); const result = await action(combined); combined.throwIfAborted(); if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw new Error('This view exceeds 4 MiB. Inspect a smaller conversation or reduce the configured discovery roots.'); return result })()
    this.operations.add(operation)
    void operation.finally(() => this.operations.delete(operation)).catch(() => undefined)
    return operation
  }
  async [Service.init](): Promise<void> {
    await this.store.init()
    this.lifetime.signal.throwIfAborted()
  }
  runtimeView(agent: Agent, signal: AbortSignal) {
    return { registry: this.ctx.agentPresets.serviceFor(agent, 'skills') ?? this.ctx.skills, preset: this.ctx.agentPresets.composedPreset(agent.ctx),
      options: { cwd: agent.session.header.cwd, scope: agent, signal } }
  }
  async snapshot(view: { registry: Context['skills']; options: SkillViewOptions; preset?: string }) {
    const signal = AbortSignal.any([this.lifetime.signal, ...(view.options.signal ? [view.options.signal] : [])])
    const state = await this.store.read()
    const snapshot = await view.registry.snapshot({ ...view.options, signal })
    const imports = await this.ctx.get('managedSkills')?.definitions(view.options.cwd, signal) ?? []
    const presets = view.preset === undefined ? [] : [view.preset]
    const entries = snapshot.skills.map(skill => {
      const managed = imports.find(item => item.provider === skill.provider && item.name === skill.name && item.path === skill.path)
      const entry = managed ?? observeSkill(skill)
      const access = decideAccess(state, entry, { cwd: view.options.cwd, presets })
      return { ...entry, status: 'winner' as 'winner' | 'inactive' | 'shadowed', sourceId: sourceKey(entry), access,
        managed: skill.provider === 'dsh-skills-manager-secure', effectiveInvocation: { modelInvocable: access.modelInvocable, userInvocable: access.userInvocable } }
    })
    for (const item of imports) if (!entries.some(entry => entry.provider === item.provider && entry.name === item.name && entry.path === item.path)) {
      const access = decideAccess(state, item, { cwd: view.options.cwd, presets })
      entries.push({ ...item, status: item.active ? 'shadowed' : 'inactive', sourceId: sourceKey(item), access,
        managed: true, effectiveInvocation: { modelInvocable: false, userInvocable: false } })
    }
    const current = await this.store.read()
    signal.throwIfAborted()
    return { entries, complete: snapshot.complete && state.revision === current.revision, policyRevision: state.revision, migrated: state.migrated && !state.needsReview, needsReview: state.needsReview ?? false }
  }
  async load(name: string, view: { registry: Context['skills']; options: SkillViewOptions; preset?: string }, invocation: 'model' | 'user') {
    if ((await this.store.read()).needsReview) throw new Error('Saved access rules require review before loading skills')
    const before = await this.snapshot(view)
    const entry = before.entries.find(entry => entry.name === name && entry.status === 'winner')
    if (!before.complete || !entry || !(invocation === 'model' ? entry.effectiveInvocation.modelInvocable : entry.effectiveInvocation.userInvocable)) throw new Error('Skill is not available for this invocation')
    const definition = await view.registry.get(name, view.options)
    const after = await this.snapshot(view)
    const current = after.entries.find(item => item.name === name && item.status === 'winner')
    if (!definition || !after.complete || after.policyRevision !== before.policyRevision || !current || definitionKey(entry) !== definitionKey(definition) || definitionKey(current) !== definitionKey(entry) || JSON.stringify(current.sourceIdentity) !== JSON.stringify(entry.sourceIdentity)) throw new Error('Skill changed while loading; retry discovery')
    return { ...definition, sourceIdentity: entry.sourceIdentity }
  }
  async selection(value: Selection, signal: AbortSignal) {
    signal.throwIfAborted()
    let cwd = value.projectRoot
    let preset = value.preset
    const id = value.sessionId === undefined ? undefined : SessionId(value.sessionId)
    if (id !== undefined) {
      if (cwd !== undefined || preset !== undefined) throw new Error('Select a conversation or a workspace and preset, not both')
      using observation = await this.ctx.sessionQuery.observeSession(id, { signal })
      if (!observation.projections) throw new Error('Conversation scope is unavailable')
      cwd = observation.header.cwd
      preset = observation.projections.values.agentPreset ?? undefined
    } else if (!cwd || !this.ctx.workspaceRegistry.list().some(workspace => workspace.path === resolve(cwd!))) {
      throw new Error('Select a registered workspace and preset')
    }
    if (!cwd) throw new Error('Conversation workspace is unavailable')
    cwd = resolve(cwd)
    if (id === undefined && !preset) throw new Error('Select an agent preset')
    const resolved = await this.ctx.agentPresets.resolve(preset)
    const live = id === undefined ? undefined : this.ctx.agents.get(id)
    const registry = live === undefined ? this.ctx.skills : this.ctx.agentPresets.serviceFor(live, 'skills') ?? this.ctx.skills
    const lease = live === undefined ? await this.ctx.agentPresets.acquireScope(resolved.id) : undefined
    return { registry, preset: live ? this.ctx.agentPresets.composedPreset(live.ctx) : resolved.id, options: { cwd, scope: live ?? lease?.key, signal },
      view: { cwd, preset: resolved.id, ...(id === undefined ? {} : { sessionId: String(id) }) },
      [Symbol.asyncDispose]: async () => { await lease?.[Symbol.asyncDispose]() } }
  }
  async context(sessionId: string, signal: AbortSignal) {
    return this.run(signal, async signal => {
      using observation = await this.ctx.sessionQuery.observeSession(SessionId(sessionId), { signal, projectionMode: 'none' })
      signal.throwIfAborted()
      return { ...projectContext(observation.events), sessionId, observation: observation.source, inheritedEventCount: observation.inheritedEventCount }
    })
  }
  async choices(signal: AbortSignal) {
    return this.run(signal, async signal => {
      const [presets, sessions] = await Promise.all([this.ctx.agentPresets.list(), this.ctx.sessionQuery.listSessions(signal)])
      return { workspaces: this.ctx.workspaceRegistry.list().map(workspace => workspace.path), presets: presets.map(preset => ({ id: preset.id })),
        sessions: sessions.slice(0, 100).map(session => ({ id: String(session.header.id), cwd: session.header.cwd })) }
    })
  }
  async inventory(value: Selection, signal: AbortSignal) {
    return this.run(signal, async signal => {
      await using selected = await this.selection(value, signal)
      const { registry, options, view, preset } = selected
      const inspection = await this.snapshot({ registry, options, preset })
      const entries = inspection.entries
      const state = await this.store.read()
      const sources = [...new Map(entries.map(entry => [entry.sourceId, { id: entry.sourceId, provider: entry.provider, source: entry.source, origin: entry.sourceIdentity?.origin ?? entry.path ?? 'Source location not recorded', mode: decideAccess(state, { ...entry, name: '', invocation: { modelInvocable: true, userInvocable: true } }, { cwd: view.cwd, presets: preset ? [preset] : [] }).mode, watched: undefined as boolean | undefined }])).values()]
      return { ...inspection, complete: inspection.complete && state.revision === inspection.policyRevision, sources, view, diagnostics: [] as { path?: string; provider: string; message: string }[],
        scope: 'Access applies to this plugin’s skill tool and explicit invocations. External provider shadowed definitions and watcher diagnostics are unavailable.',
        counts: { candidates: entries.length, available: entries.filter(entry => entry.status === 'winner' && (entry.effectiveInvocation.modelInvocable || entry.effectiveInvocation.userInvocable)).length,
          automatic: entries.filter(entry => entry.status === 'winner' && entry.effectiveInvocation.modelInvocable).length,
          manual: entries.filter(entry => entry.status === 'winner' && !entry.effectiveInvocation.modelInvocable && entry.effectiveInvocation.userInvocable).length } }
    })
  }
  async change(value: Selection, revision: number, input: unknown, signal: AbortSignal) {
    return this.run(signal, async signal => {
      const rule = validateRule(input)
      const inventory = await this.inventory(value, signal)
      if (!inventory.complete) throw new Error('Discovery is incomplete; refresh before changing access')
      if (!inventory.sources.some(source => source.id === rule.source) || (rule.skill !== undefined && !inventory.entries.some(entry => entry.sourceId === rule.source && entry.name === rule.skill))) throw new Error('Source or skill changed; refresh and review again')
      if (rule.scope.kind === 'workspace' && rule.scope.value !== inventory.view.cwd) throw new Error('Rule workspace does not match the selected view')
      if (rule.scope.kind === 'preset' && rule.scope.value !== inventory.view.preset) throw new Error('Rule preset does not match the selected view')
      await this.store.change(revision, [rule], signal)
      return this.inventory(value, signal)
    })
  }
  async migration(value: Selection, mode: AccessMode, signal: AbortSignal) {
    return this.run(signal, async signal => {
      if (!['off', 'manual', 'automatic'].includes(mode)) throw new Error('Invalid migration mode')
      const inventory = await this.inventory(value, signal)
      const sources = inventory.needsReview ? inventory.sources : inventory.sources.filter(source => sharedSource(source.source))
      const rules: AccessRuleInput[] = sources.map(source => ({ source: source.id, scope: { kind: 'global' }, mode }))
      const snapshot = createHash('sha256').update(JSON.stringify([inventory.policyRevision, rules, inventory.sources.map(source => [source.id, source.mode])])).digest('hex')
      return { snapshot, revision: inventory.policyRevision, complete: inventory.complete, rules, sources,
        explanation: inventory.needsReview ? 'This upgrade changes source identities. Confirming replaces all saved source and scoped rules with the listed global choices. Shared sources discovered later require admission. Review each workspace and preset restriction again before use.' : 'Applies to the listed shared sources globally in DSH. New shared sources require explicit admission. Existing conversation content stays in history.' }
    })
  }
  async migrate(value: Selection, revision: number, mode: AccessMode, snapshot: string, signal: AbortSignal) {
    return this.run(signal, async signal => {
      const preview = await this.migration(value, mode, signal)
      if (!preview.complete || preview.revision !== revision || preview.snapshot !== snapshot) throw new Error('Migration changed or discovery incomplete; review again')
      await this.store.change(revision, preview.rules, signal, true)
      return this.inventory(value, signal)
    })
  }
  async detail(value: Selection, source: string, name: string, signal: AbortSignal) {
    return this.run(signal, async signal => {
      await using selected = await this.selection(value, signal)
      const { registry, options, preset } = selected
      const inspection = await this.snapshot({ registry, options, preset })
      const entry = inspection.entries.find(entry => entry.name === name && entry.sourceId === source)
      if (!entry) throw new Error('Skill is no longer discovered')
      if (entry.status !== 'winner') return { entry, content: null, reason: 'Only the current winning definition can be previewed. Manage inactive copies under Imported copies.' }
      const definition = await registry.get(name, options)
      const current = await this.snapshot({ registry, options, preset })
      const winner = current.entries.find(item => item.name === name && item.status === 'winner')
      const coherent = inspection.complete && current.complete && definition && winner && definitionKey(definition) === definitionKey(entry) && definitionKey(winner) === definitionKey(entry) && JSON.stringify(winner.sourceIdentity) === JSON.stringify(entry.sourceIdentity)
      return { entry: coherent ? { ...entry, ...definition, sourceIdentity: entry.sourceIdentity } : entry,
        content: coherent ? definition.content.slice(0, 256 * 1024) : null, truncated: coherent ? definition.content.length > 256 * 1024 : false,
        reason: coherent ? null : 'The definition changed or cannot be loaded. Refresh and try again.' }

    })
  }
}

declare module '@deepseek-ai/cordis' { interface Context { skillAccess: SkillAccess } }
export default SkillAccess
