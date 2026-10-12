import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillManager } from '../../lib/index.js'

const root = await fs.mkdtemp(join(tmpdir(), 'dsh-cleanup-fault-'))
const originalRm = fs.rm
const originalRename = fs.rename
const warnings = []
const manager = new SkillManager({ workspaceRegistry: { list: () => [] }, get: () => undefined, logger: { warn: message => warnings.push(message) } }, { storageDir: join(root, 'storage') })
let published = false
let injected = false
try {
  const source = join(root, 'source')
  await fs.mkdir(source)
  await fs.writeFile(join(source, 'SKILL.md'), '---\nname: alpha\ndescription: Cleanup fixture\n---\nBody\n')
  fs.rename = async (...args) => { const result = await originalRename(...args); if (String(args[1]).endsWith('/state.json')) published = true; return result }
  fs.rm = async (path, ...args) => {
    const target = String(path)
    const match = process.argv[2] === 'lock' ? target.endsWith('/.mutation-lock') : target.includes('/staging/snapshot-')
    if (published && match && !injected) { injected = true; throw Object.assign(new Error('Injected cleanup failure'), { code: 'EACCES' }) }
    return originalRm(path, ...args)
  }
  syncBuiltinESMExports()
  const result = await manager.install(source)
  assert.equal(result.entries[0].name, 'alpha')
  assert.ok(injected, 'the filesystem fault was exercised')
  assert.ok(warnings.length > 0, 'cleanup failure produces a maintenance warning')
  assert.equal((await manager.catalog()).entries[0].name, 'alpha')
  assert.equal((await manager.setEnabled('alpha', 'global', undefined, true)).entries[0].globalEnabled, true)
} finally {
  fs.rm = originalRm
  fs.rename = originalRename
  syncBuiltinESMExports()
  await manager.dispose()
  await fs.rm(root, { recursive: true, force: true })
}
