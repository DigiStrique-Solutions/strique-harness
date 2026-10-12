import { watchFile, unwatchFile } from 'node:fs'
import { cp, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { isEnabledFor, removeSkill, setEnabled, setModelInvocation } from './state.js'
import { localOrigin, parseSkill, repositoryOrigin, skillName, snapshot } from './source.js'
import { Storage, type Installed, type StoredState } from './storage.js'
import type { ObservedDefinition } from './skill-view.js'
import { createHandler } from './http.js'
import type { SkillCatalog, SkillInspectResult, SkillOrigin, SkillScope, SkillUpdateReport, SkillUpdateReportEntry } from './types.js'

export const name = 'dsh-skills-manager-secure'
export const inject = ['skills', 'connection', 'webServer', 'workspaceRegistry']
export interface Config { readonly storageDir?: string; readonly maxStorageBytes?: number }
export const Config: Schema<Config> = Schema.object({ storageDir: Schema.string().default(''), maxStorageBytes: Schema.number().min(1).step(1).default(256 * 1024 * 1024) })

export class SkillManager {
  private readonly storage: Storage
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<unknown>>()
  private control?: SkillProviderControl
  private snapshotCount = 0
  private readonly maxStorageBytes: number
  constructor(private readonly ctx: Context, config: Config) {
    if (config.storageDir?.trim() && !isAbsolute(config.storageDir)) throw new Error('storageDir must be absolute')
    this.maxStorageBytes = config.maxStorageBytes ?? 256 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxStorageBytes) || this.maxStorageBytes < 1) throw new Error('maxStorageBytes must be a positive safe integer')
    this.storage = new Storage(config.storageDir?.trim() || join(resolveDshHome(), 'skills-manager-secure'), message => this.ctx.logger.warn(message))
  }
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([...this.active])
  }
  private run<T>(signal: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : []), AbortSignal.timeout(120_000)])
    const promise = (async () => { combined.throwIfAborted(); await this.storage.init(); combined.throwIfAborted(); return task(combined) })()
    this.active.add(promise)
    void promise.finally(() => this.active.delete(promise)).catch(() => undefined)
    return promise
  }
  private async withSnapshot<T>(origin: SkillOrigin, signal: AbortSignal, task: (value: Awaited<ReturnType<typeof snapshot>>) => Promise<T>): Promise<T> {
    if (this.snapshotCount >= 2) throw new Error('Two source operations are already running; try again shortly')
    this.snapshotCount++
    try {
      const staged = await snapshot(origin, this.storage.staging, signal, path => this.storage.cleanup(path))
      try { return await task(staged) } finally { await staged.dispose() }
    } finally { this.snapshotCount-- }
  }
  projectRoots(): string[] { return this.ctx.workspaceRegistry.list().map(workspace => workspace.path).sort() }
  validateProject(projectRoot?: string): string | undefined {
    if (projectRoot === undefined) return undefined
    if (!isAbsolute(projectRoot) || !this.projectRoots().includes(resolve(projectRoot))) throw new Error('Select a registered workspace')
    return resolve(projectRoot)
  }
  private catalogFrom(state: StoredState, projectRoot?: string): SkillCatalog {
    return {
      entries: Object.entries(state.installs).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({
        name, description: item.description, sourceType: item.sourceType,
        ...(item.sourceType === 'local' ? { sourcePath: item.source } : { sourceUrl: item.source + (item.ref ? `#${item.ref}` : '') }),
        globalEnabled: state.globalEnabled.includes(name),
        projectEnabled: projectRoot !== undefined && (state.projectEnabled[projectRoot] ?? []).includes(name),
        effectiveEnabled: isEnabledFor(state, name, projectRoot),
        modelInvocable: (Object.hasOwn(state.modelInvocation, name) ? state.modelInvocation[name] : item.modelInvocable),
        updateSupported: true,
      })),
      projectRoots: this.projectRoots(),
    }
  }
  catalog(projectRoot?: string, signal?: AbortSignal): Promise<SkillCatalog> {
    return this.run(signal, async () => this.catalogFrom(await this.storage.read(), this.validateProject(projectRoot)))
  }
  provider(control: SkillProviderControl): SkillProvider {
    this.control = control
    const watched = join(this.storage.root, 'state.json')
    const lifecycle = AbortSignal.any([this.lifetime.signal, control.signal])
    const changed = () => { if (!lifecycle.aborted) this.invalidate() }
    const stop = () => unwatchFile(watched, changed)
    if (!lifecycle.aborted) {
      watchFile(watched, { persistent: false, interval: 200 }, changed)
      lifecycle.addEventListener('abort', stop, { once: true })
    }
    return {
      name,
      list: options => this.run(AbortSignal.any([control.signal, ...(options.signal ? [options.signal] : [])]), async () => {
        const state = await this.storage.read()
        const candidates: SkillCandidate[] = []
        const inactiveCandidates: SkillCandidate[] = []
        for (const [skill, item] of Object.entries(state.installs)) {
          const candidate: SkillCandidate = { ...this.summary(state, skill, item), rank: 50, locator: item.object }
          ;(isEnabledFor(state, skill, options.cwd) ? candidates : inactiveCandidates).push(candidate)
        }
        return { candidates, inactiveCandidates, complete: true }
      }),
      get: (candidate, options) => this.run(AbortSignal.any([control.signal, ...(options.signal ? [options.signal] : [])]), async () => {
        const state = await this.storage.read()
        const item = Object.hasOwn(state.installs, candidate.name) ? state.installs[candidate.name] : undefined
        if (!item || candidate.locator !== item.object || !isEnabledFor(state, candidate.name, options.cwd)) return undefined
        let markdown: string
        try { markdown = await readFile(join(this.storage.objects, item.object, item.layout === 'source' ? item.relativePath : '', 'SKILL.md'), 'utf8') }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
        const parsed = parseSkill(markdown)
        return { ...this.summary(state, candidate.name, item), content: parsed.content }
      }),
    }
  }
  private summary(state: StoredState, skill: string, item: Installed): Omit<ObservedDefinition, 'content'> {
    const root = join(this.storage.objects, item.object, item.layout === 'source' ? item.relativePath : '')
    return { name: skill, description: item.description, ...(item.whenToUse ? { whenToUse: item.whenToUse } : {}), ...(item.metadata ? { metadata: item.metadata } : {}), provider: name, source: name, sourceIdentity: { origin: JSON.stringify([item.sourceType, item.source, item.ref ?? null]), location: join(root, 'SKILL.md'), version: item.hash }, path: join(root, 'SKILL.md'), resourceBase: { kind: 'directory', path: root }, invocation: { modelInvocable: (Object.hasOwn(state.modelInvocation, skill) ? state.modelInvocation[skill] : item.modelInvocable), userInvocable: item.userInvocable } }
  }
  definitions(cwd?: string, signal?: AbortSignal) {
    return this.run(signal, async () => {
      const state = await this.storage.read()
      return Object.entries(state.installs).map(([name, item]) => ({ ...this.summary(state, name, item), active: isEnabledFor(state, name, cwd) }))
    })
  }
  inspect(path: string, signal?: AbortSignal): Promise<SkillInspectResult> { return this.inspectOrigin(() => localOrigin(path), signal) }
  inspectRemote(repository: string, signal?: AbortSignal): Promise<SkillInspectResult> { return this.inspectOrigin(async () => repositoryOrigin(repository), signal) }
  private inspectOrigin(origin: () => Promise<SkillOrigin>, signal?: AbortSignal): Promise<SkillInspectResult> {
    return this.run(signal, async signal => this.withSnapshot(await origin(), signal, async staged => ({ entries: staged.skills.map(({ name, description }) => ({ name, description })), snapshot: staged.digest, diagnostics: staged.diagnostics })))
  }
  install(path: string, skills?: readonly string[], projectRoot?: string, signal?: AbortSignal, digest?: string): Promise<SkillCatalog> {
    return this.importOrigin(() => localOrigin(path), skills, projectRoot, signal, digest)
  }
  installRemote(repository: string, skills?: readonly string[], projectRoot?: string, signal?: AbortSignal, digest?: string): Promise<SkillCatalog> {
    return this.importOrigin(async () => repositoryOrigin(repository), skills, projectRoot, signal, digest)
  }
  private importOrigin(origin: () => Promise<SkillOrigin>, skills: readonly string[] | undefined, projectRoot: string | undefined, signal: AbortSignal | undefined, digest?: string): Promise<SkillCatalog> {
    return this.run(signal, async signal => {
      this.validateProject(projectRoot)
      const selected = skills?.map(skillName)
      if (selected && (!selected.length || new Set(selected).size !== selected.length)) throw new Error('Select at least one unique skill')
      const source = await origin()
      return this.withSnapshot(source, signal, async staged => {
        if (digest !== undefined && digest !== staged.digest) throw new Error('Source changed since inspection; inspect it again before importing')
        if (!selected && staged.diagnostics.length) throw new Error(staged.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'))
        const selection = selected ?? staged.skills.map(skill => skill.name)
        if (!selection.length || selection.some(name => !staged.skills.some(skill => skill.name === name))) throw new Error('Selection contains no installable skills or an unknown skill')
        return this.storage.lock(signal, async () => {
          const state = await this.storage.read()
          for (const name of selection) if (Object.hasOwn(state.installs, name)) throw new Error(`Skill ${name} is already installed. Use Update for its recorded source, or remove it before importing a replacement.`)
          if (Object.keys(state.installs).length + selection.length > 256) throw new Error('Library limit is 256 skills')
          const installs = { ...state.installs }
          const created: string[] = []
          await this.storage.reserve(staged.root, this.maxStorageBytes, signal)
          try {
            const object = randomUUID()
            created.push(object)
            await cp(staged.root, join(this.storage.objects, object), { recursive: true, force: false, errorOnExist: true, dereference: false })
            for (const name of selection) {
              signal.throwIfAborted()
              const skill = staged.skills.find(skill => skill.name === name)!
              installs[name] = { ...source, object, layout: 'source', relativePath: skill.relativePath, hash: staged.digest, description: skill.description, modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable, whenToUse: skill.whenToUse, metadata: skill.metadata }
            }
            const next = { ...state, installs }
            const catalog = this.catalogFrom(next, projectRoot)
            await this.storage.commit(next, signal)
            created.length = 0
            this.invalidate()
            return catalog
          } finally { for (const object of created) await rm(join(this.storage.objects, object), { recursive: true, force: true }) }
        })
      })
    })
  }
  update(skill: string, sourcePath?: string, projectRoot?: string, signal?: AbortSignal): Promise<SkillCatalog> {
    return this.run(signal, async signal => {
      skillName(skill); this.validateProject(projectRoot)
      const initial = await this.storage.read()
      const previous = Object.hasOwn(initial.installs, skill) ? initial.installs[skill] : undefined
      if (!previous) throw new Error(`Skill is not installed: ${skill}`)
      if (sourcePath && (previous.sourceType !== 'local' || (await localOrigin(sourcePath)).source !== previous.source)) throw new Error('Updates must use the recorded source; remove the skill before replacing it')
      return this.updateGroup([[skill, previous]], projectRoot, signal)
    })
  }
  updateMany(names: readonly string[], projectRoot?: string, signal?: AbortSignal) {
    return this.run(signal, async signal => {
      this.validateProject(projectRoot)
      if (!names.length || names.length > 256 || new Set(names).size !== names.length) throw new Error('Select unique installed skills')
      const initial = await this.storage.read()
      const groups = new Map<string, [string, Installed][]>()
      for (const name of names) {
        skillName(name)
        const item = Object.hasOwn(initial.installs, name) ? initial.installs[name] : undefined
        if (!item) throw new Error(`Skill is not installed: ${name}`)
        const key = JSON.stringify([item.sourceType, item.source, item.ref ?? null])
        groups.set(key, [...groups.get(key) ?? [], [name, item]])
      }
      const results: { names: string[]; ok: boolean; error?: string }[] = []
      for (const group of groups.values()) {
        signal.throwIfAborted()
        try { await this.updateGroup(group, projectRoot, signal); results.push({ names: group.map(([name]) => name), ok: true }) }
        catch (error) {
          signal.throwIfAborted()
          results.push({ names: group.map(([name]) => name), ok: false, error: error instanceof Error && !('code' in error) ? error.message.slice(0, 512) : 'Storage or source is unavailable' })
        }
      }
      return { catalog: this.catalogFrom(await this.storage.read(), projectRoot), results }
    })
  }
  private updateGroup(group: readonly [string, Installed][], projectRoot: string | undefined, signal: AbortSignal): Promise<SkillCatalog> {
    const origin = group[0][1]
    return this.withSnapshot(origin, signal, async staged => this.storage.lock(signal, async () => {
      const state = await this.storage.read()
      const installs = { ...state.installs }
      for (const [name, previous] of group) {
        if (state.installs[name]?.object !== previous.object) throw new Error('Skill changed during update; refresh and retry')
        const latest = staged.skills.find(entry => entry.name === name && entry.relativePath === previous.relativePath)
        const diagnostic = staged.diagnostics.find(item => item.path === join(previous.relativePath, 'SKILL.md'))
        if (diagnostic) throw new Error(`Skill cannot be updated: ${diagnostic.message}`)
        if (!latest) throw new Error('Skill was deleted or moved upstream; remove it before importing a replacement')
        installs[name] = { ...previous, layout: 'source', hash: staged.digest, description: latest.description, modelInvocable: latest.modelInvocable, userInvocable: latest.userInvocable, whenToUse: latest.whenToUse, metadata: latest.metadata }
      }
      const reusable = Object.values(state.installs).find(item => item.layout === 'source' && item.hash === staged.digest && item.sourceType === origin.sourceType && item.source === origin.source && item.ref === origin.ref)
      const object = reusable?.object ?? randomUUID()
      let committed = false
      try {
        if (!reusable) {
          await this.storage.reserve(staged.root, this.maxStorageBytes, signal)
          await cp(staged.root, join(this.storage.objects, object), { recursive: true, errorOnExist: true, force: false })
        }
        for (const [name] of group) installs[name] = { ...installs[name], object }
        const next = { ...state, installs }
        const catalog = this.catalogFrom(next, projectRoot)
        await this.storage.commit(next, signal)
        committed = true
        this.invalidate()
        return catalog
      } finally { if (!reusable && !committed) await rm(join(this.storage.objects, object), { recursive: true, force: true }) }
    }))
  }
  private invalidate(): void { try { this.control?.invalidate() } catch { /* Publication already succeeded. */ } }
  private change(skill: string, projectRoot: string | undefined, signal: AbortSignal | undefined, transform: (state: StoredState) => StoredState): Promise<SkillCatalog> {
    return this.run(signal, async signal => {
      skillName(skill); this.validateProject(projectRoot)
      return this.storage.lock(signal, async () => {
        const state = await this.storage.read()
        if (!Object.hasOwn(state.installs, skill)) throw new Error(`Skill is not installed: ${skill}`)
        const next = transform(state)
        const catalog = this.catalogFrom(next, projectRoot)
        await this.storage.commit(next, signal)
        this.invalidate()
        return catalog
      })
    })
  }
  setEnabled(name: string, scope: SkillScope, projectRoot: string | undefined, enabled: boolean, signal?: AbortSignal): Promise<SkillCatalog> {
    if (!['global', 'project'].includes(scope) || typeof enabled !== 'boolean') return Promise.reject(new Error('Invalid enablement request'))
    return this.change(name, projectRoot, signal, state => ({ ...state, ...setEnabled(state, name, scope, projectRoot, enabled) }))
  }
  setModelInvocable(name: string, enabled: boolean, projectRoot?: string, signal?: AbortSignal): Promise<SkillCatalog> {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Invalid invocation request'))
    return this.change(name, projectRoot, signal, state => ({ ...state, ...setModelInvocation(state, name, enabled) }))
  }
  remove(name: string, projectRoot?: string, signal?: AbortSignal): Promise<SkillCatalog> {
    return this.change(name, projectRoot, signal, state => ({ ...state, ...removeSkill(state, name), installs: Object.fromEntries(Object.entries(state.installs).filter(([key]) => key !== name)) }))
  }
  checkUpdates(name?: string, signal?: AbortSignal): Promise<SkillUpdateReport> {
    return this.run(signal, async signal => {
      if (name) skillName(name)
      const entries = Object.entries((await this.storage.read()).installs).filter(([key]) => name === undefined || key === name)
      const groups = new Map<string, typeof entries>()
      for (const entry of entries) {
        const key = JSON.stringify([entry[1].sourceType, entry[1].source, entry[1].ref])
        groups.set(key, [...groups.get(key) ?? [], entry])
      }
      const pending = [...groups.values()]
      const report: SkillUpdateReportEntry[] = []
      // At most two clones, including all members of each shared source.
      const worker = async () => {
        while (pending.length) {
          signal.throwIfAborted()
          const group = pending.shift()!
          try {
            await this.withSnapshot(group[0][1], signal, async staged => {
              for (const [name, item] of group) {
                const latest = staged.skills.find(skill => skill.name === name && skill.relativePath === item.relativePath)
                const invalid = staged.diagnostics.some(entry => entry.path === join(item.relativePath, 'SKILL.md'))
                report.push({ name, status: invalid ? 'unknown' : !latest ? 'deleted-upstream' : item.layout === 'source' && staged.digest === item.hash ? 'current' : 'update-available' })
              }
            })
          } catch {
            signal.throwIfAborted()
            report.push(...group.map(([name]) => ({ name, status: 'unknown' as const })))
          }
        }
      }
      await Promise.all([worker(), worker()])
      return { entries: report.sort((a, b) => a.name.localeCompare(b.name)) }
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  const manager = new SkillManager(ctx, config)
  ctx.effect(() => () => manager.dispose(), 'skills-manager: operation lifetime')
  ctx.provide('managedSkills', manager)
  ctx.skills.registerProvider(control => manager.provider(control))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/skills-manager-secure', handler: createHandler(ctx, manager) }), 'skills-manager: authenticated route')
}

declare module '@deepseek-ai/cordis' { interface Context { managedSkills: SkillManager } }
