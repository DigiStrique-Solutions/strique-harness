import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { EMPTY_STATE, isRecord, normalizeState } from './state.js'
import type { ManagerState, SkillOrigin } from './types.js'

export interface Installed extends SkillOrigin {
  readonly object: string
  /** Absent for 0.2.0 records containing only the skill subtree. */
  readonly layout?: 'source'
  readonly relativePath: string
  readonly hash: string
  readonly description: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly whenToUse?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}
export interface StoredState extends ManagerState {
  readonly installs: Readonly<Record<string, Installed>>
}

/** State.json is the sole commit point; object directories are immutable. */
export class Storage {
  readonly root: string
  readonly objects: string
  readonly staging: string
  private readonly pendingCleanup = new Map<string, { dev: number; ino: number }>()
  constructor(root: string, private readonly warn: (message: string) => void = () => undefined) {
    if (!isAbsolute(root)) throw new Error('storageDir must be absolute')
    this.root = resolve(root)
    this.objects = join(this.root, 'objects')
    this.staging = join(this.root, 'staging')
  }
  async init(): Promise<void> {
    for (const path of [this.root, this.objects, this.staging]) {
      await mkdir(path, { recursive: true, mode: 0o700 })
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Storage must use real directories, not symlinks')
    }
  }
  async read(): Promise<StoredState> {
    let file
    try { file = await open(join(this.root, 'state.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_STATE, installs: {} }
      throw error
    }
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('Invalid state file')
      const value: unknown = JSON.parse(await file.readFile('utf8'))
      const state = normalizeState(value)
      if (!isRecord(value) || !isRecord(value.installs)) throw new Error('Legacy storage is not modified by this fork; use its separate storage directory')
      if (Object.keys(value.installs).length > 256) throw new Error('Too many installed skills')
      for (const [name, item] of Object.entries(value.installs)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !isRecord(item)
          || typeof item.object !== 'string' || !/^[0-9a-f-]{36}$/.test(item.object)
          || (item.layout !== undefined && item.layout !== 'source')
          || typeof item.source !== 'string' || !['local', 'git'].includes(String(item.sourceType))
          || typeof item.relativePath !== 'string' || isAbsolute(item.relativePath) || item.relativePath.split(/[\\/]/).includes('..')
          || typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash)
          || typeof item.description !== 'string' || typeof item.modelInvocable !== 'boolean' || typeof item.userInvocable !== 'boolean'
          || (item.whenToUse !== undefined && typeof item.whenToUse !== 'string')
          || (item.metadata !== undefined && !isRecord(item.metadata))
          || (item.ref !== undefined && typeof item.ref !== 'string')) throw new Error('Invalid installed skill record')
      }
      return { ...state, installs: value.installs as unknown as Record<string, Installed> }
    } finally { await file.close() }
  }
  async commit(state: StoredState, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const encoded = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw new Error('Library metadata exceeds 4 MiB')
    const temp = join(this.root, `state-${randomUUID()}.tmp`)
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(encoded)
      await file.sync()
    } catch (error) { await rm(temp, { force: true }); throw error }
    finally { await file.close() }
    let published = false
    try {
      signal.throwIfAborted()
      // Nothing may throw after this publication point and report a false failure.
      await rename(temp, join(this.root, 'state.json'))
      published = true
    } finally { if (!published) await this.cleanup(temp) }
  }
  /** Maintenance must not turn committed mutations into reported failures. */
  async cleanup(path: string): Promise<void> {
    let identity
    try {
      identity = await lstat(path)
      await rm(path, { recursive: true, force: true })
      this.pendingCleanup.delete(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.pendingCleanup.delete(path); return }
      if (identity) this.pendingCleanup.set(path, { dev: identity.dev, ino: identity.ino })
      try { this.warn('Skills maintenance: temporary storage cleanup failed; it will be retried before the next mutation. Persistent failures may require storage recovery.') } catch { /* Logging cannot undo publication. */ }
    }
  }
  async lock<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    await this.init()
    for (const [path, identity] of this.pendingCleanup) {
      const current = await lstat(path).catch(() => undefined)
      // Never remove a new lock owned by another manager after replacement.
      if (current?.dev === identity.dev && current.ino === identity.ino) await this.cleanup(path)
      else this.pendingCleanup.delete(path)
    }
    const lock = join(this.root, '.mutation-lock')
    const until = Date.now() + 30_000
    while (true) {
      signal.throwIfAborted()
      try { await mkdir(lock, { mode: 0o700 }); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now() >= until) throw new Error('Skills storage is busy. If the owner crashed, remove .mutation-lock after confirming no manager is writing.')
        await delay(25, undefined, { signal })
      }
    }
    try {
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
      signal.throwIfAborted()
      return await action()
    } finally { await this.cleanup(lock) }
  }
  /** Called under the mutation lock before copying; published versions are never evicted. */
  async reserve(source: string, maxBytes: number, signal: AbortSignal): Promise<void> {
    let bytes = 0
    let entries = 0
    async function count(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        signal.throwIfAborted()
        if (++entries > 65_536) throw new Error('Retained storage limit reached (65536 entries); archive completed conversations and their resources before cleanup')
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await count(path)
        else if (entry.isFile()) bytes += (await lstat(path)).size
        else throw new Error('Storage cannot contain symlinks or special files')
        if (bytes > maxBytes) throw new Error('Retained storage limit reached; increase maxStorageBytes or archive completed conversations and their resources before cleanup')
      }
    }
    await count(this.objects)
    await count(source)
  }
}
