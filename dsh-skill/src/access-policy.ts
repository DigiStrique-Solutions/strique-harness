import { constants } from 'node:fs'
import { open, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ObservedSkill as SkillSummary } from './skill-view.js'
import { Storage } from './storage.js'
import { isRecord } from './state.js'

export type AccessMode = 'off' | 'manual' | 'automatic'
export type AccessScope = { kind: 'global' } | { kind: 'workspace' | 'preset'; value: string }
export interface AccessRuleInput { source: string; skill?: string; mode: AccessMode; scope: AccessScope }
export interface AccessRule extends AccessRuleInput { at: string; action: 'explicit' | 'migration' }
export interface AccessState { version: 1; revision: number; migrated: boolean; rules: AccessRule[]; identityVersion?: 2; needsReview?: boolean }
export interface AccessDecision { mode: AccessMode; modelInvocable: boolean; userInvocable: boolean; reason: string; recorded: boolean; rules: AccessRule[] }
const modes: AccessMode[] = ['off', 'manual', 'automatic']

/** Source approval follows the provider and origin, never just the display name or resource version. */
export function sourceKey(skill: Pick<SkillSummary, 'source' | 'provider' | 'sourceIdentity' | 'resourceBase'>): string {
  return createHash('sha256').update(JSON.stringify([skill.provider, skill.source, skill.sourceIdentity?.origin ?? skill.resourceBase ?? null])).digest('hex')
}
export function sharedSource(source: string): boolean { return source === 'user-agents' || source === 'user-dsh' }

/** Pure evaluation shared by administrative explanations and the runtime policy. */
export function decideAccess(state: AccessState, skill: SkillSummary, view: { cwd?: string; presets?: readonly string[] }): AccessDecision {
  if (state.needsReview) return { mode: 'off', modelInvocable: false, userInvocable: false, reason: 'Saved access rules require review after the upstream-only upgrade.', recorded: true, rules: state.rules }
  const source = sourceKey(skill)
  const rules = state.rules.filter(rule => rule.source === source && (rule.skill === undefined || rule.skill === skill.name)
    && (rule.scope.kind === 'global' || (rule.scope.kind === 'workspace' ? rule.scope.value === view.cwd : view.presets?.includes(rule.scope.value))))
  const global = rules.filter(rule => rule.scope.kind === 'global')
  const admission = global.find(rule => rule.skill === undefined)
  const fallback = state.migrated && sharedSource(skill.source) ? 'off' : 'automatic'
  let mode = admission?.mode ?? fallback
  const restrict = (limit: AccessMode) => { if (modes.indexOf(limit) < modes.indexOf(mode)) mode = limit }
  const override = global.find(rule => rule.skill === skill.name)
  if (override && mode !== 'off') mode = override.mode
  for (const rule of rules) if (rule.scope.kind !== 'global') restrict(rule.mode)
  const userInvocable = mode !== 'off' && skill.invocation.userInvocable
  const modelInvocable = mode === 'automatic' && skill.invocation.modelInvocable
  const effective = modelInvocable ? 'automatic' : userInvocable ? 'manual' : 'off'
  return { mode: effective, modelInvocable, userInvocable, recorded: rules.length > 0,
    reason: rules.length ? `DSH rule applies; declared invocation limits also apply.` : state.migrated && sharedSource(skill.source)
      ? 'Shared personal source requires explicit DSH admission.' : 'Automatically discovered; approval not recorded.', rules }
}

export function validateRule(value: unknown): AccessRuleInput {
  if (!isRecord(value) || typeof value.source !== 'string' || !/^[a-f0-9]{64}$/.test(value.source)
    || !modes.includes(value.mode as AccessMode) || (value.skill !== undefined && (typeof value.skill !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.skill)))
    || !isRecord(value.scope) || !['global', 'workspace', 'preset'].includes(String(value.scope.kind))
    || (value.scope.kind !== 'global' && (typeof value.scope.value !== 'string' || !value.scope.value || value.scope.value.length > 4096))) throw new Error('Invalid access rule')
  return { source: value.source, ...(value.skill === undefined ? {} : { skill: value.skill as string }), mode: value.mode as AccessMode,
    scope: value.scope.kind === 'global' ? { kind: 'global' } : { kind: value.scope.kind as 'workspace' | 'preset', value: value.scope.value as string } }
}

/** A separately owned policy file. Missing or corrupt committed state never grants access. */
export class PolicyStore {
  private readonly storage: Storage
  constructor(readonly root: string) { this.storage = new Storage(root) }
  async init(): Promise<void> {
    await this.storage.lock(AbortSignal.timeout(30_000), async () => {
      try { await this.read() }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const marker = await lstat(join(this.root, '.initialized')).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
        if (marker) throw new Error('Initialized access policy is missing; restore the policy backup before enabling skills')
        await this.commit({ version: 1, revision: 0, migrated: false, rules: [], identityVersion: 2 }, AbortSignal.timeout(30_000))
      }
      await writeFile(join(this.root, '.initialized'), '1', { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    })
  }
  async read(): Promise<AccessState> {
    const file = await open(join(this.root, 'policy.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid access policy file')
      const buffer = Buffer.alloc(info.size + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > info.size) throw new Error('Invalid access policy size')
      let value: unknown
      try { value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) } catch { throw new Error('Invalid access policy JSON') }
      if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.migrated !== 'boolean' || !Array.isArray(value.rules) || value.rules.length > 4096) throw new Error('Invalid access policy')
      const rules = value.rules.map(rule => {
        const input = validateRule(rule)
        if (!isRecord(rule) || typeof rule.at !== 'string' || !Number.isFinite(Date.parse(rule.at)) || !['explicit', 'migration'].includes(String(rule.action))) throw new Error('Invalid access policy record')
        return { ...input, at: rule.at, action: rule.action as AccessRule['action'] }
      })
      if (new Set(rules.map(ruleId)).size !== rules.length) throw new Error('Invalid duplicate access rules')
      return { version: 1, revision: value.revision as number, migrated: value.migrated, rules, ...(value.identityVersion === 2 ? { identityVersion: 2 as const } : {}), needsReview: value.identityVersion !== 2 && rules.length > 0 }
    } finally { await file.close() }
  }
  async change(revision: number, changes: readonly AccessRuleInput[], signal = AbortSignal.timeout(30_000), migration = false): Promise<AccessState> {
    const validated = changes.map(validateRule)
    return this.storage.lock(signal, async () => {
      const previous = await this.read()
      if (previous.revision !== revision) throw new Error('Access policy changed; refresh and review again')
      if (previous.needsReview && !migration) throw new Error('Saved access rules require migration review')
      const rules = new Map((previous.needsReview && migration ? [] : previous.rules).map(rule => [ruleId(rule), rule]))
      for (const rule of validated) rules.set(ruleId(rule), { ...rule, at: new Date().toISOString(), action: migration ? 'migration' : 'explicit' })
      const next: AccessState = { version: 1, revision: revision + 1, migrated: previous.migrated || migration, rules: [...rules.values()], identityVersion: 2, needsReview: false }
      if (next.rules.length > 4096) throw new Error('Access policy limit is 4096 rules')
      await this.commit(next, signal)
      return next
    })
  }
  private async commit(value: AccessState, signal: AbortSignal): Promise<void> {
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error('Access policy exceeds 1 MiB')
    const temporary = join(this.root, `policy-${randomUUID()}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    try {
      try { await file.writeFile(encoded); await file.sync() }
      finally { await file.close() }
      signal.throwIfAborted(); await rename(temporary, join(this.root, 'policy.json'))
    }
    finally { await rm(temporary, { force: true }).catch(() => undefined) }
  }
}
function ruleId(rule: AccessRuleInput): string { return JSON.stringify([rule.source, rule.skill ?? null, rule.scope]) }
