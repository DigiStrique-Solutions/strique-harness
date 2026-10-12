import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillManager } from './index.js'
import type { AccessMode } from './access-policy.js'
import type { Selection } from './access-service.js'
import type {} from './access-service.js'
import { isRecord } from './state.js'

export function localRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const peer = req.socket?.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '')) return false
  if (req.headers.forwarded !== undefined || req.headers['x-forwarded-for'] !== undefined || req.headers['x-forwarded-host'] !== undefined) return false
  const host = req.headers.host ?? ''
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)
}

export function createHandler(ctx: Context, manager: SkillManager) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { res.writeHead(rejection); res.end('Access denied'); return }
    const endpoint = (req.url ?? '').split('?')[0].slice('/skills-manager-secure/'.length)
    const writable = localRequest(req)
    if (req.method !== 'POST') { res.writeHead(405); res.end('Use POST'); return }
    if (endpoint !== 'list' && !writable) { res.writeHead(403); res.end('Skill changes and source inspection require a direct localhost connection'); return }
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { res.writeHead(415); res.end('Use application/json'); return }
    const lifetime = new AbortController()
    const disconnect = () => { if (!res.writableFinished) lifetime.abort() }
    req.once('aborted', disconnect)
    res.once('close', disconnect)
    let rpcId = 'invalid-request'
    const respond = (result: unknown) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
    }
    try {
      const args = await readBody(req, AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]))
      if (!isRecord(args) || args.type !== 'client-request' || typeof args.rpcId !== 'string' || args.rpcId.length > 128 || args.method !== endpoint || !isRecord(args.payload)) throw new Error('Invalid request envelope')
      rpcId = args.rpcId
      const payload = args.payload
      const optional = (key: string) => payload[key] === undefined ? undefined : string(payload[key], key)
      const root = optional('projectRoot')
      manager.validateProject(root)
      const signal = lifetime.signal
      const selection: Selection = { ...(root === undefined ? {} : { projectRoot: root }), ...(optional('sessionId') === undefined ? {} : { sessionId: optional('sessionId') }), ...(optional('preset') === undefined ? {} : { preset: optional('preset') }) }
      const access = () => { const service = ctx.get('skillAccess'); if (!service) throw new Error('Skill inventory and enforcement are unavailable. Check the skill access plugin.'); return service }
      const revision = () => { if (!Number.isSafeInteger(payload.revision) || (payload.revision as number) < 0) throw new Error('Invalid policy revision'); return payload.revision as number }
      let value: unknown
      switch (endpoint) {
        case 'choices': value = await access().choices(signal); break
        case 'inventory': value = { ...await access().inventory(selection, signal), writable }; break
        case 'detail': value = await access().detail(selection, string(payload.source, 'source'), string(payload.name, 'name'), signal); break
        case 'context': value = await access().context(string(payload.sessionId, 'sessionId'), signal); break
        case 'access': value = { ...await access().change(selection, revision(), payload.rule, signal), writable }; break
        case 'migration-preview': value = await access().migration(selection, string(payload.mode, 'mode') as AccessMode, signal); break
        case 'migrate': value = { ...await access().migrate(selection, revision(), string(payload.mode, 'mode') as AccessMode, string(payload.snapshot, 'snapshot'), signal), writable }; break
        case 'list': value = { ...await manager.catalog(root, signal), writable }; break
        case 'inspect': value = await manager.inspect(string(payload.path, 'path'), signal); break
        case 'inspect-remote': value = await manager.inspectRemote(string(payload.repository, 'repository'), signal); break
        case 'install':
        case 'install-remote': {
          if (!Array.isArray(payload.skills) || !payload.skills.length || payload.skills.length > 256 || payload.skills.some(item => typeof item !== 'string')) throw new Error('Select valid skills')
          const digest = string(payload.snapshot, 'snapshot')
          if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Inspect the source before importing')
          value = endpoint === 'install'
            ? await manager.install(string(payload.path, 'path'), payload.skills as string[], root, signal, digest)
            : await manager.installRemote(string(payload.repository, 'repository'), payload.skills as string[], root, signal, digest)
          break
        }
        case 'update-many': {
          if (!Array.isArray(payload.names) || payload.names.some(name => typeof name !== 'string')) throw new Error('Select valid skills')
          value = await manager.updateMany(payload.names as string[], root, signal); break
        }
        case 'update': value = await manager.update(string(payload.name, 'name'), optional('path'), root, signal); break
        case 'set-enabled': {
          if (payload.scope !== 'global' && payload.scope !== 'project') throw new Error('Invalid scope')
          value = await manager.setEnabled(string(payload.name, 'name'), payload.scope, root, boolean(payload.enabled), signal); break
        }
        case 'set-model-invocation': value = await manager.setModelInvocable(string(payload.name, 'name'), boolean(payload.modelInvocable), root, signal); break
        case 'remove': value = await manager.remove(string(payload.name, 'name'), root, signal); break
        case 'check-updates': value = await manager.checkUpdates(optional('name'), signal); break
        default: throw new Error('Unknown skills endpoint')
      }
      if (isRecord(value) && 'projectRoots' in value) value = { ...value, writable }
      respond({ ok: true, value })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed'
      // Filesystem exceptions include private paths. Return a bounded business error.
      respond({ ok: false, error: { code: 'skills/operation-failed', message: isRecord(error) && typeof error.code === 'string' ? 'Storage or source is unavailable' : message.slice(0, 512), details: {} } })
    } finally {
      req.off('aborted', disconnect)
      res.off('close', disconnect)
    }
  }
}
function string(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new Error(`Invalid ${key}`)
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean')
  return value
}
async function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', abort) }
    const error = (error: Error) => { cleanup(); req.resume(); reject(error) }
    const abort = () => error(new Error('Request cancelled or timed out'))
    const data = (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024) error(new Error('Request exceeds 16 KiB')); else chunks.push(chunk) }
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid JSON')) } }
    req.on('data', data); req.once('end', end); req.once('error', error)
    signal.addEventListener('abort', abort, { once: true })
  })
}
