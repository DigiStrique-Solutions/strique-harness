import { foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'
import { isRecord } from './state.js'

export interface SkillLoadView { name: string; seq: number; turn: number | null; trigger: 'user' | 'model'; status: 'current' | 'historical' | 'failed' | 'log-only'; sourceIdentity: unknown | null; characters: number }
export interface ToolSchemaView { name: string; description: string; sourceIdentity: 'unavailable' }
export interface RequestView { seq: number; turn: number | null; step: number | null; status: 'prepared' | 'settled'; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number } | null }
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {} }
function textLength(blocks: unknown): number { return Array.isArray(blocks) ? blocks.reduce((sum, block) => sum + (record(block).type === 'text' && typeof record(block).text === 'string' ? (record(block).text as string).length : textLength(record(block).content)), 0) : 0 }

/** Deterministic projection of one observed log cut. Current catalogs never rewrite historical attribution. */
export function projectContext(events: readonly SessionEvent[]) {
  if (events.length > 200_000) throw new Error('Context inspection is limited to 200000 recorded events')
  const current = new Set<number>(foldSurface(events).nodes)
  const calls = new Map<string, { name: string; skill: string | null }>()
  const summaries = new Map<string, { name: string; description: string; seq: number }>()
  const loads: SkillLoadView[] = []
  const requests: RequestView[] = []
  // Requests retain the recorded header sequence; send that catalog only once.
  const catalogs: Record<number, ToolSchemaView[]> = {}
  let turn: number | null = null
  let step: number | null = null
  let header: Record<string, unknown> | null = null
  let headerSeq: number | null = null
  let pending: RequestView | undefined
  let summaryCharacters = 0
  for (const event of events) {
    const data = record(event.data)
    if (event.type === 'step/start') { turn = data.turn as number; step = data.step as number; pending = undefined }
    if (event.type === 'request/header') {
      header = record(data.header); headerSeq = event.seq
      catalogs[headerSeq] = schemas(header)
      pending = { seq: event.seq, turn, step, status: 'prepared', usage: null }
      requests.push(pending)
    }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      // A settled event proves an attempt existed, not the adapter's exact wire payload.
      if (!pending && header && headerSeq !== null) { pending = { seq: headerSeq, turn, step, status: 'prepared', usage: null }; requests.push(pending) }
      if (pending) { pending.status = 'settled'; if (event.type === 'assistant/message') pending.usage = event.data.usage ?? null; pending = undefined }
    }
    if (event.type === 'tool/call') {
      let skill: string | null = null
      try { const args: unknown = JSON.parse(event.data.arguments); if (typeof record(args).name === 'string') skill = record(args).name as string } catch { /* Malformed model arguments are recorded failed attempts, not loaded bodies. */ }
      calls.set(String(event.data.callId), { name: event.data.name, skill })
    }
    if (event.type === 'user/message') {
      const source = record(event.data.source)
      if ((source.kind === 'skill-catalog' || source.kind === 'managed-skill-catalog') && current.has(event.seq)) {
        summaries.clear()
        summaryCharacters = textLength(event.data.content)
        for (const item of Array.isArray(source.entries) ? source.entries : []) {
          if (typeof record(item).name === 'string') summaries.set(record(item).name as string, { name: record(item).name as string, description: typeof record(item).description === 'string' ? record(item).description as string : '', seq: event.seq })
        }
      }
      if ((source.kind === 'skill-invocation' || source.kind === 'managed-skill-invocation') && typeof source.name === 'string') loads.push({ name: source.name, seq: event.seq, turn, trigger: 'user', status: current.has(event.seq) ? 'current' : event.surfaceOp ? 'historical' : 'log-only', sourceIdentity: sourceIdentity(source.sourceIdentity ?? source.provenance), characters: textLength(event.data.content) })
    }
    if (event.type === 'tool/result') {
      const message = event.data.message
      const call = calls.get(String(message.toolCallId))
      if (call?.name === 'skill') loads.push({ name: call.skill ?? 'Unknown skill', seq: event.seq, turn: event.data.turn, trigger: 'model',
        status: message.isError || event.data.error ? 'failed' : current.has(event.seq) ? 'current' : event.surfaceOp ? 'historical' : 'log-only',
        sourceIdentity: sourceIdentity(record(event.data.meta).skillSourceIdentity ?? record(event.data.meta).skillProvenance), characters: textLength(message.content) })
    }
  }
  const active = loads.filter(load => load.status === 'current')
  const bodyCharacters = active.reduce((sum, load) => sum + load.characters, 0)
  return { capturedThroughSeq: events.at(-1)?.seq ?? null, summaryCount: summaries.size, summaries: [...summaries.values()],
    loadedSkillCount: new Set(active.map(load => load.name)).size, loadOccurrenceCount: active.length, loads,
    requests, catalogs, toolsCount: headerSeq === null ? null : catalogs[headerSeq].length,
    textEstimates: { method: 'Rough estimate: text characters divided by 4; not a model tokenizer or measured usage.', summaries: Math.ceil(summaryCharacters / 4), instructions: Math.ceil(bodyCharacters / 4) },
    resourceReads: 'Unavailable: arbitrary file reads, shell scripts and copied instructions cannot be reliably attributed.',
    requestExplanation: 'Reconstructed from recorded request headers and attempt settlements. Tool source identity and exact adapter wire payload are unavailable. Prepared does not prove dispatch.' }
}
function schemas(header: Record<string, unknown>): ToolSchemaView[] {
  return (Array.isArray(header.tools) ? header.tools : []).map(tool => ({ name: typeof record(tool).name === 'string' ? record(tool).name as string : 'Unknown tool', description: typeof record(tool).description === 'string' ? record(tool).description as string : '', sourceIdentity: 'unavailable' as const }))
}

function sourceIdentity(value: unknown): { origin: string; location?: string; version?: string } | null {
  const item = record(value)
  if (typeof item.origin !== 'string') return null
  return { origin: item.origin.slice(0, 4096), ...(typeof item.location === 'string' ? { location: item.location.slice(0, 4096) } : {}), ...(typeof item.version === 'string' ? { version: item.version.slice(0, 4096) } : {}) }
}
