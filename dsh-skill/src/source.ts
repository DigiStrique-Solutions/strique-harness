import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { runProcess } from './process.js'
import { isRecord } from './state.js'
import type { SkillDiagnostic, SkillOrigin } from './types.js'

export interface SourceSkill {
  name: string
  description: string
  content: string
  relativePath: string
  modelInvocable: boolean
  userInvocable: boolean
  whenToUse?: string
  metadata?: Readonly<Record<string, unknown>>
}
export interface Snapshot {
  root: string
  skills: SourceSkill[]
  diagnostics: SkillDiagnostic[]
  digest: string
  dispose(): Promise<void>
}
export function skillName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) throw new Error('Skill names must be lowercase kebab-case, at most 64 characters')
  return value
}
export async function localOrigin(path: string): Promise<SkillOrigin> {
  if (!isAbsolute(path) || path.length > 4096 || path.includes('\0')) throw new Error('Source must be an absolute directory path')
  return { source: await realpath(path), sourceType: 'local' }
}
export function repositoryOrigin(input: string): SkillOrigin {
  if (input.length > 2048 || /[\s\x00-\x1f]/.test(input) || input.startsWith('-')) throw new Error('Invalid repository address')
  const source = /^[\w.-]+\/[\w.-]+$/.test(input) ? `https://github.com/${input}.git` : input
  let url: URL
  try { url = new URL(source) } catch { throw new Error('Use owner/repo or an HTTPS Git URL') }
  if (url.username || url.password || url.search) throw new Error('Repository URLs must not contain credentials or query parameters')
  // file URLs are local imports through Git, subject to the same Host locality gate.
  if (!['https:', 'file:'].includes(url.protocol) || (url.protocol === 'file:' && url.hostname)) throw new Error('Only HTTPS and local file Git URLs are supported')
  const ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined
  if (ref && (!/^[\w./-]{1,128}$/.test(ref) || ref.startsWith('-') || ref.includes('..'))) throw new Error('Invalid Git ref')
  url.hash = ''
  return { source: url.href, sourceType: 'git', ...(ref ? { ref } : {}) }
}

/** Fetch/copy once, then discover and install only these private staged bytes. */
export async function snapshot(origin: SkillOrigin, staging: string, signal: AbortSignal, cleanup: (path: string) => Promise<void> = path => rm(path, { recursive: true, force: true })): Promise<Snapshot> {
  signal.throwIfAborted()
  const work = await mkdtemp(join(staging, 'snapshot-'))
  const root = join(work, 'files')
  await mkdir(root, { mode: 0o700 })
  const dispose = () => cleanup(work)
  try {
    let source = origin.source
    if (origin.sourceType === 'git') {
      const checked = repositoryOrigin(origin.source + (origin.ref ? `#${origin.ref}` : ''))
      source = join(work, 'checkout')
      await runProcess('git', [
        '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never',
        '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always',
        'clone', '--depth', '1', '--no-recurse-submodules', '--quiet',
        ...(checked.ref ? ['--branch', checked.ref] : []), '--', checked.source, source,
      ], signal, work)
    }
    await runProcess('python3', ['-I', fileURLToPath(new URL('../snapshot.py', import.meta.url)), await realpath(source), root], signal)
    const skills: SourceSkill[] = []
    const diagnostics: SkillDiagnostic[] = []
    let discovered = 0
    async function discover(dir: string): Promise<void> {
      signal.throwIfAborted()
      const entries = await readdir(dir, { withFileTypes: true })
      if (entries.some(item => item.name === 'SKILL.md' && item.isFile())) {
        if (++discovered > 256) throw new Error('Source exceeds maximum skills (256)')
        const markdown = await readFile(join(dir, 'SKILL.md'), 'utf8')
        try {
          const parsed = parseSkill(markdown)
          skills.push({ ...parsed, relativePath: relative(root, dir) })
        } catch (error) {
          diagnostics.push({ path: relative(root, join(dir, 'SKILL.md')), message: error instanceof Error ? error.message : 'Invalid skill metadata' })
        }
      }
      for (const entry of entries) if (entry.isDirectory()) await discover(join(dir, entry.name))
    }
    await discover(root)
    const counts = new Map<string, number>()
    for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1)
    const valid = skills.filter(skill => {
      if (counts.get(skill.name) === 1) return true
      diagnostics.push({ path: join(skill.relativePath, 'SKILL.md'), message: `Duplicate skill name in source: ${skill.name}` })
      return false
    })
    diagnostics.sort((a, b) => a.path.localeCompare(b.path))
    signal.throwIfAborted()
    return { root, diagnostics, skills: valid.sort((a, b) => a.name.localeCompare(b.name)), digest: await hashFolder(root), dispose }
  } catch (error) { await dispose(); throw error }
}

export function parseSkill(markdown: string): Omit<SourceSkill, 'relativePath'> {
  if (Buffer.byteLength(markdown) > 256 * 1024) throw new Error('SKILL.md exceeds 256 KiB')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown)
  if (!match) throw new Error('SKILL.md requires YAML frontmatter')
  const doc = parseDocument(match[1], { uniqueKeys: true, customTags: [] })
  if (doc.errors.length) throw new Error('Invalid skill frontmatter')
  const data: unknown = doc.toJS({ maxAliasCount: 0 })
  if (!isRecord(data)) throw new Error('Invalid skill frontmatter')
  const name = skillName(data.name)
  if (typeof data.description !== 'string' || !data.description.trim() || data.description.length > 4096) throw new Error(`Skill ${name} needs a description of 1 to 4096 characters`)
  for (const key of ['disable-model-invocation', 'user-invocable']) if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Skill ${name} has invalid invocation metadata`)
  if (data.whenToUse !== undefined && (typeof data.whenToUse !== 'string' || data.whenToUse.length > 4096)) throw new Error('Invalid whenToUse metadata')
  if (data.metadata !== undefined && (!isRecord(data.metadata) || JSON.stringify(data.metadata).length > 32 * 1024)) throw new Error('Skill metadata exceeds 32 KiB or is not an object')
  return { name, ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}), ...(isRecord(data.metadata) ? { metadata: data.metadata } : {}), description: data.description.trim(), content: match[2].trim(), modelInvocable: data['disable-model-invocation'] !== true, userInvocable: data['user-invocable'] !== false }
}

export async function hashFolder(dir: string): Promise<string> {
  const hash = createHash('sha256')
  async function walk(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) { hash.update(JSON.stringify(['directory', relative(dir, file)])); await walk(file) }
      else if (entry.isFile()) {
        const bytes = await readFile(file)
        hash.update(JSON.stringify([relative(dir, file), (await stat(file)).mode & 0o111 ? 1 : 0, bytes.length]))
        hash.update(bytes)
      } else throw new Error('Snapshots cannot contain symlinks or special files')
    }
  }
  await walk(dir)
  return hash.digest('hex')
}
