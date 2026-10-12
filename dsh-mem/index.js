/**
 * dsh-mem — persistent agent memory for the dsh harness.
 *
 * Host half. Owns:
 * - a storage domain (`dsh_mem`, per-record JSON) holding the memory records;
 * - one `memory` tool (search/save/update/delete/list) for the agent;
 * - a static system-prompt section teaching memory discipline;
 * - a standing-memory digest injected once per created agent;
 * - self-learning: failed tool calls are auto-captured as `observed` lessons;
 * - an authenticated `/api/dsh-mem/memories` route for the Web UI panel.
 *
 * Plain JavaScript by design: the bundle installs without a build step and
 * declares no dependencies on harness packages.
 */

import { randomUUID } from 'node:crypto'

/** The memory tool's model-facing name. */
export const TOOL_NAME = 'memory'

/** Services the memory features cannot work without; the plugin stays inactive without them. */
export const inject = ['tools', 'systemPrompt', 'storageDomain']

/** Record kinds, fixed for the domain format version below. */
const KINDS = ['lesson', 'preference', 'fact', 'concept']
/** Lesson articulation states: `observed` (auto-captured) and `learned` (a fix was written). */
const STATUSES = ['observed', 'learned']
/** Who produced the record. */
const ORIGINS = ['auto', 'model', 'user']

/**
 * Resolve and clamp the row's config. Values arrive unvalidated (this bundle
 * declares no schema), so every field is coerced here instead of trusted.
 * @param raw - the `config` object from the Loader row.
 * @returns the resolved configuration.
 */
function resolveConfig(raw) {
  const c = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    digestMaxChars: clampInt(c.digestMaxChars, 300, 8000, 1200),
    standingTopK: clampInt(c.standingTopK, 3, 50, 12),
    autoLessons: c.autoLessons === undefined ? true : Boolean(c.autoLessons),
    autoLessonCap: clampInt(c.autoLessonCap, 5, 500, 40),
    maxMemories: clampInt(c.maxMemories, 20, 5000, 200),
    searchLimit: clampInt(c.searchLimit, 1, 50, 8),
  }
}

/**
 * Clamp and integer-coerce one config value.
 * @param value - raw value, possibly of the wrong type.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @param fallback - value used when the raw value is not a finite number.
 * @returns the clamped integer.
 */
function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Build the duck-typed record schema the storage-domain facility validates at
 * the durable read boundary (`valueSchema.parse`); zod is not importable from
 * a plain bundle, and this shape only needs `parse` to throw on invalid data.
 * @returns the validating schema object.
 */
function makeRecordSchema() {
  return {
    /**
     * Validate one stored memory record.
     * @param raw - record read back from the medium.
     * @returns the same record.
     */
    parse(raw) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('dsh-mem record must be an object')
      }
      assertString(raw.id, 'id')
      assertOneOf(raw.kind, KINDS, 'kind')
      assertString(raw.title, 'title')
      assertString(raw.body, 'body')
      assertOneOf(raw.origin, ORIGINS, 'origin')
      if (raw.status !== undefined) assertOneOf(raw.status, STATUSES, 'status')
      if (raw.key !== undefined) assertString(raw.key, 'key')
      if (raw.occurrences !== undefined) assertInt(raw.occurrences, 'occurrences', 1)
      if (raw.lastSeenAt !== undefined) assertInt(raw.lastSeenAt, 'lastSeenAt', 0)
      if (!Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== 'string')) {
        throw new Error('dsh-mem record.tags must be an array of strings')
      }
      if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0) {
        throw new Error('dsh-mem record.confidence must be a finite number >= 0')
      }
      assertInt(raw.hits, 'hits', 0)
      assertInt(raw.createdAt, 'createdAt', 0)
      assertInt(raw.updatedAt, 'updatedAt', 0)
      return raw
    },
  }
}

/**
 * Assert a non-empty string field.
 * @param value - field value.
 * @param field - field name for the error message.
 */
function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dsh-mem record.${field} must be a non-empty string`)
  }
}

/**
 * Assert a value inside a closed set.
 * @param value - field value.
 * @param allowed - the allowed values.
 * @param field - field name for the error message.
 */
function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`dsh-mem record.${field} must be one of ${allowed.join(', ')}`)
  }
}

/**
 * Assert an integer field at or above a floor.
 * @param value - field value.
 * @param field - field name for the error message.
 * @param min - inclusive lower bound.
 */
function assertInt(value, field, min) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`dsh-mem record.${field} must be an integer >= ${min}`)
  }
}

/** The static model-facing memory policy; kept small because it ships on every request. */
const PROMPT_SECTION = [
  '## Memory (dsh-mem)',
  'A persistent `memory` tool carries lessons, preferences, facts, and concepts across sessions.',
  '- Before retrying a failed approach or redoing familiar work, call it with `action: "search"` first; a recorded lesson, preference, or concept may already cover it.',
  '- When the user corrects you, when a failure shows a reusable fix, or when the user states a durable preference or fact, save ONE concise memory with `action: "save"`. Update or delete outdated entries instead of accumulating near-duplicates.',
  '- Saving a lesson whose subject matches an auto-captured mistake marks it learned and raises its rank.',
  '- Keep bodies short and imperative: recalled memory costs tokens.',
].join('\n')

/**
 * Plugin activation.
 * @param ctx - plugin context; every registration is an effect owned here.
 * @param rawConfig - the row's `config` object.
 */
export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'dsh-mem:memory',
    order: 2450,
    text: PROMPT_SECTION,
    interpolate: false,
  }), 'dsh-mem: memory prompt')

  const domain = await ctx.storageDomain.open({
    name: 'dsh_mem',
    version: 1,
    // Records are individually disposable derived data: an unreadable record
    // is backed up and skipped so a corrupt entry cannot block boot.
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: {
      memories: { valueSchema: makeRecordSchema() },
    },
  })
  const table = domain.table('memories')
  ctx.effect(() => () => domain.close(), 'dsh-mem: close storage domain')

  /** All records as an array. @returns the record snapshot. */
  const allRecords = () => Array.from(table.entries(), ([, record]) => record)

  /**
   * Value score used for ranking the standing digest and list results.
   * @param record - a memory record.
   * @returns the score.
   */
  const scoreOf = (record) => {
    const ageDays = Math.max(0, (Date.now() - record.updatedAt) / 86_400_000)
    const recency = ageDays <= 14 ? 0.3 : ageDays <= 60 ? 0.1 : 0
    const learned = record.kind === 'lesson' && record.status === 'learned' ? 0.5 : 0
    return record.confidence + learned + Math.min(record.hits, 10) * 0.05 + recency
  }

  /**
   * Find one record by a prior stored key (lesson dedupe) or by id.
   * @param key - the stored key.
   * @returns the record or undefined.
   */
  const findByKey = (key) => allRecords().find(record => record.key === key)

  // One tool with an action discriminator keeps the schema (and therefore the
  // per-request token cost) smaller than several single-purpose tools.
  const tool = {
    name: TOOL_NAME,
    description:
      'Persistent memory for this workspace, spanning sessions. '
      + 'search: recall lessons learned from past mistakes, user preferences, durable facts, and distilled concepts before redoing work or re-explaining. '
      + 'save: write one memory (kind lesson/preference/fact/concept) when the user corrects you, a failure reveals a reusable fix, or a durable preference or fact emerges. '
      + 'update: replace title/body/tags of one memory by id. '
      + 'delete: remove one outdated or wrong memory by id. '
      + 'list: show the highest-value memories in compact form.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'save', 'update', 'delete', 'list'], description: 'Operation to perform.' },
        query: { type: 'string', description: 'Search text; terms match title, body, and tags (action=search).' },
        id: { type: 'string', description: 'Memory id (action=update|delete).' },
        kind: { type: 'string', enum: KINDS, description: 'Memory kind (action=save).' },
        title: { type: 'string', description: 'Short imperative title, e.g. "Run tests before committing" (action=save).' },
        body: { type: 'string', description: 'What to remember and why, concise (action=save).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional short tags (action=save|update).' },
        limit: { type: 'number', description: 'Max results, default 8 (action=search|list).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          error: { type: 'string' },
          memories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                kind: { type: 'string' },
                status: { type: 'string' },
                origin: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' },
                hits: { type: 'number' },
                updatedAt: { type: 'number' },
              },
              required: ['id', 'kind', 'title', 'body'],
              additionalProperties: false,
            },
          },
          saved: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
          deleted: { type: 'boolean' },
        },
        required: ['ok', 'action'],
        additionalProperties: false,
      },
      /**
       * Compact model-facing projection of the canonical value.
       * @param args - parsed tool arguments.
       * @param value - the canonical result value.
       * @returns the content blocks.
       */
      render(args, value) {
        const label = `${TOOL_NAME} ${value.action}`
        if (!value.ok) return [{ type: 'text', text: `${label} failed: ${value.error ?? 'unknown error'}` }]
        if (value.action === 'delete') {
          return [{ type: 'text', text: value.deleted ? `${label}: deleted.` : `${label}: not found (already deleted).` }]
        }
        if (value.action === 'save') {
          return [{ type: 'text', text: `${label}: stored "${value.saved?.title}" (${value.saved?.kind}, id ${value.saved?.id}).` }]
        }
        if (value.action === 'update') {
          return [{ type: 'text', text: `${label}: updated ${value.saved?.id ?? ''}.` }]
        }
        const memories = value.memories ?? []
        if (memories.length === 0) return [{ type: 'text', text: `${label}: no matching memories.` }]
        const lines = memories.map(m => {
          const status = m.kind === 'lesson' && m.status !== undefined ? ` [${m.status}]` : ''
          const tags = m.tags.length > 0 ? ` #${m.tags.join(' #')}` : ''
          return `- (${m.kind}${status}) ${m.title}: ${m.body}${tags} [id ${m.id}]`
        })
        return [{ type: 'text', text: `${label} — ${memories.length} result(s):\n${lines.join('\n')}` }]
      },
    },
    /**
     * Run one memory operation.
     * @param args - parsed model arguments.
     * @param _exec - execution context (unused; memory is workspace-global).
     * @returns the canonical result value.
     */
    async execute(args, _exec) {
      const action = typeof args?.action === 'string' ? args.action : ''
      try {
        switch (action) {
          case 'search': return await runSearch(args)
          case 'list': return await runList(args)
          case 'save': return await runSave(args, 'model')
          case 'update': return await runUpdate(args)
          case 'delete': return await runDelete(args)
          default: return { ok: false, action: action || 'unknown', error: `unknown action; use one of search, save, update, delete, list` }
        }
      } catch (error) {
        return { ok: false, action: action || 'unknown', error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  ctx.effect(() => ctx.tools.register(tool), 'dsh-mem: memory tool')

  /**
   * Search memories by term overlap; recalled records gain a hit.
   * @param args - parsed arguments.
   * @returns the canonical result.
   */
  async function runSearch(args) {
    const query = typeof args.query === 'string' ? args.query : ''
    const limit = clampInt(args.limit, 1, 50, config.searchLimit)
    const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(term => term.length > 1)
    const scored = allRecords()
      .map(record => ({ record, score: matchScore(record, terms) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || scoreOf(b.record) - scoreOf(a.record))
      .slice(0, limit)
    for (const { record } of scored) {
      table.put(record.id, { ...record, hits: record.hits + 1 })
        .catch(error => console.error('[dsh-mem] hit-count write failed:', error))
    }
    return { ok: true, action: 'search', memories: scored.map(({ record }) => publicView(record)) }
  }

  /**
   * List the highest-value memories.
   * @param args - parsed arguments.
   * @returns the canonical result.
   */
  async function runList(args) {
    const limit = clampInt(args.limit, 1, 50, config.standingTopK)
    const memories = allRecords()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, limit)
      .map(publicView)
    return { ok: true, action: 'list', memories }
  }

  /**
   * Save one memory; an existing record with the same title key is updated
   * instead of duplicated, and a model-saved lesson matching an auto-captured
   * mistake is promoted to `learned`.
   * @param args - parsed arguments.
   * @param origin - producer tag for the new record.
   * @returns the canonical result.
   */
  async function runSave(args, origin) {
    const title = requireString(args.title, 'title')
    const body = requireString(args.body, 'body')
    const kind = KINDS.includes(args.kind) ? args.kind : 'fact'
    const tags = Array.isArray(args.tags) ? args.tags.filter(tag => typeof tag === 'string').slice(0, 8) : []
    const now = Date.now()
    const key = `${kind}:${title.trim().toLowerCase()}`
    const existing = findByKey(key)
    if (existing !== undefined) {
      const promoted = kind === 'lesson' && existing.status === 'observed' ? 'learned' : existing.status
      const next = {
        ...existing,
        body,
        tags: tags.length > 0 ? tags : existing.tags,
        origin: existing.origin === 'auto' ? origin : existing.origin,
        status: promoted ?? existing.status,
        confidence: Math.min(1, existing.confidence + 0.3),
        updatedAt: now,
      }
      await table.put(existing.id, next)
      return { ok: true, action: 'save', saved: { id: existing.id, title: next.title, kind: next.kind } }
    }
    if (table.size >= config.maxMemories) {
      return { ok: false, action: 'save', error: `memory store full (${config.maxMemories}); delete an outdated memory first` }
    }
    const record = {
      id: `m${now.toString(36)}${randomUUID().slice(0, 8)}`,
      kind,
      title: title.trim(),
      body: body.trim(),
      tags,
      origin,
      ...(kind === 'lesson' ? { status: origin === 'auto' ? 'observed' : 'learned' } : {}),
      confidence: origin === 'user' ? 1 : 0.8,
      hits: 0,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(record.id, record)
    return { ok: true, action: 'save', saved: { id: record.id, title: record.title, kind: record.kind } }
  }

  /**
   * Update one memory's editable fields.
   * @param args - parsed arguments.
   * @returns the canonical result.
   */
  async function runUpdate(args) {
    if (typeof args.id !== 'string' || args.id.length === 0) {
      return { ok: false, action: 'update', error: 'update requires id' }
    }
    const current = table.get(args.id)
    if (current === undefined) return { ok: false, action: 'update', error: `no memory with id ${args.id}` }
    const next = { ...current, updatedAt: Date.now() }
    if (typeof args.title === 'string' && args.title.trim().length > 0) next.title = args.title.trim()
    if (typeof args.body === 'string' && args.body.trim().length > 0) next.body = args.body.trim()
    if (Array.isArray(args.tags)) next.tags = args.tags.filter(tag => typeof tag === 'string').slice(0, 8)
    if (KINDS.includes(args.kind)) next.kind = args.kind
    if (STATUSES.includes(args.status)) next.status = args.status
    await table.put(next.id, next)
    return { ok: true, action: 'update', saved: { id: next.id, title: next.title, kind: next.kind } }
  }

  /**
   * Delete one memory.
   * @param args - parsed arguments.
   * @returns the canonical result.
   */
  async function runDelete(args) {
    if (typeof args.id !== 'string' || args.id.length === 0) {
      return { ok: false, action: 'delete', error: 'delete requires id' }
    }
    const deleted = await table.delete(args.id)
    return { ok: true, action: 'delete', deleted }
  }

  /**
   * Require a non-empty string argument.
   * @param value - raw value.
   * @param field - argument name.
   * @returns the trimmed value.
   */
  function requireString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`save requires a non-empty ${field}`)
    }
    return value
  }

  /**
   * Term-overlap score between a record and the search terms.
   * @param record - a memory record.
   * @param terms - lowercased query terms.
   * @returns the match score; 0 means no match.
   */
  function matchScore(record, terms) {
    if (terms.length === 0) return 0
    const haystack = `${record.title}\n${record.body}\n${record.tags.join('\n')}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (record.title.toLowerCase().includes(term)) score += 2
      if (haystack.includes(term)) score += 1
    }
    return score
  }

  /**
   * Project a record to its public (log/wire) view.
   * @param record - a memory record.
   * @returns the view object.
   */
  function publicView(record) {
    return {
      id: record.id,
      kind: record.kind,
      ...(record.status !== undefined ? { status: record.status } : {}),
      ...(record.origin !== undefined ? { origin: record.origin } : {}),
      title: record.title,
      body: record.body,
      tags: record.tags,
      confidence: record.confidence,
      hits: record.hits,
      updatedAt: record.updatedAt,
    }
  }

  // Self-learning: every failed tool call becomes (or strengthens) an
  // auto-captured lesson so repeated mistakes surface in the standing digest.
  ctx.effect(() => ctx.on('tools/result', (exec, result) => {
    try {
      captureMistake(exec, result)
    } catch (error) {
      console.error('[dsh-mem] mistake capture failed:', error)
    }
  }), 'dsh-mem: tools/result observer')

  /**
   * Capture one failed tool call as an observed lesson.
   * @param exec - the executed call (name and arguments).
   * @param result - the frozen final result.
   */
  function captureMistake(exec, result) {
    if (!config.autoLessons || !exec || exec.name === TOOL_NAME) return
    if (!result || result.isError !== true) return
    const errorText = contentText(result.content).slice(0, 200)
    const line = normalizeErrorLine(errorText)
    if (line.length === 0) return
    const key = `auto:${exec.name}:${line}`
    const now = Date.now()
    const existing = findByKey(key)
    if (existing !== undefined) {
      table.put(existing.id, {
        ...existing,
        occurrences: (existing.occurrences ?? 1) + 1,
        lastSeenAt: now,
        updatedAt: now,
      }).catch(error => console.error('[dsh-mem] lesson strengthening failed:', error))
      return
    }
    const record = {
      id: `a${now.toString(36)}${randomUUID().slice(0, 8)}`,
      kind: 'lesson',
      status: 'observed',
      origin: 'auto',
      key,
      title: `${exec.name} failed: ${line}`,
      body: errorText,
      tags: ['auto', exec.name],
      confidence: 0.3,
      hits: 0,
      occurrences: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }
    table.put(record.id, record)
      .then(() => enforceAutoLessonCap())
      .catch(error => console.error('[dsh-mem] lesson capture failed:', error))
  }

  /**
   * Keep auto-origin lessons within the configured cap, deleting the stalest.
   * @returns completion of the trimming writes.
   */
  async function enforceAutoLessonCap() {
    const auto = allRecords()
      .filter(record => record.origin === 'auto' && record.kind === 'lesson')
      .sort((a, b) => (a.lastSeenAt ?? a.updatedAt) - (b.lastSeenAt ?? b.updatedAt))
    for (let index = 0; index < auto.length - config.autoLessonCap; index++) {
      await table.delete(auto[index].id)
    }
  }

  // Standing digest: injected once per created agent so the model starts with
  // its learned lessons, preferences, and concepts without re-learning them.
  ctx.effect(() => ctx.on('agent/created', (payload) => {
    try {
      const digest = standingDigest()
      if (digest.length === 0) return
      payload.agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: digest }],
        source: { kind: 'dsh-mem' },
      })
    } catch (error) {
      console.error('[dsh-mem] standing digest injection failed:', error)
    }
  }), 'dsh-mem: standing digest on agent/created')

  /**
   * Render the standing-memory digest for a new agent.
   * @returns the digest text, or '' when nothing is worth injecting.
   */
  function standingDigest() {
    const records = allRecords()
    const sections = [
      { heading: 'Lessons learned from past mistakes:', records: pick(records, r => r.kind === 'lesson' && r.status === 'learned') },
      { heading: 'Lessons observed but not yet articulated (verify before trusting):', records: pick(records, r => r.kind === 'lesson' && r.status === 'observed'), max: 3 },
      { heading: 'User preferences:', records: pick(records, r => r.kind === 'preference') },
      { heading: 'Distilled concepts:', records: pick(records, r => r.kind === 'concept') },
      { heading: 'Durable facts:', records: pick(records, r => r.kind === 'fact'), max: 5 },
    ]
    const lines = []
    let budget = config.digestMaxChars
    for (const section of sections) {
      const rows = []
      for (const record of section.records) {
        const line = `- ${record.title}: ${truncate(record.body, 180)}`
        if (line.length > budget) break
        budget -= line.length + 1
        rows.push(line)
      }
      if (rows.length > 0) lines.push(section.heading, ...rows)
    }
    if (lines.length === 0) return ''
    return [
      '[dsh-mem] Standing memory for this session (use the `memory` tool to search, save, update, or delete):',
      ...lines,
    ].join('\n')
  }

  /**
   * Pick and rank one kind of records for the digest.
   * @param records - all records.
   * @param predicate - kind predicate.
   * @param max - optional cap distinct from standingTopK.
   * @returns the ranked records.
   */
  function pick(records, predicate, max) {
    return records
      .filter(predicate)
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, Math.min(max ?? config.standingTopK, config.standingTopK))
  }

  /**
   * Truncate one line under a bound.
   * @param text - source text.
   * @param max - maximum characters.
   * @returns the truncated single-line text.
   */
  function truncate(text, max) {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
  }

  // Web UI data route: authenticated by the shared /api carrier (browser
  // cookie), buffered JSON, one exact path below /api.
  ctx.inject(['connection'], (webCtx) => {
    const disposer = webCtx.connection.fetch.register({
      path: '/api/dsh-mem/memories',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: handleApiRequest,
    })
    ctx.effect(() => disposer, 'dsh-mem: /api route')
  })

  /**
   * Serve the UI panel's reads and writes.
   * @param request - the authenticated fetch request.
   * @returns the JSON response.
   */
  async function handleApiRequest(request) {
    try {
      if (request.method === 'GET') {
        const records = allRecords().sort((a, b) => b.updatedAt - a.updatedAt).map(publicView)
        return Response.json({
          memories: records,
          stats: {
            total: records.length,
            learned: records.filter(r => r.kind === 'lesson' && r.status === 'learned').length,
            observed: records.filter(r => r.kind === 'lesson' && r.status === 'observed').length,
            preferences: records.filter(r => r.kind === 'preference').length,
            facts: records.filter(r => r.kind === 'fact').length,
            concepts: records.filter(r => r.kind === 'concept').length,
          },
        })
      }
      const body = await request.json()
      const action = typeof body?.action === 'string' ? body.action : ''
      if (action === 'save') return Response.json(await runSave(body, 'user'))
      if (action === 'update') return Response.json(await runUpdate(body))
      if (action === 'delete') return Response.json(await runDelete(body))
      return Response.json({ ok: false, error: `unsupported action ${action}` }, { status: 400 })
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  }
}

/**
 * Extract concatenated text from content blocks.
 * @param content - content blocks.
 * @returns the joined text.
 */
function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join(' ')
}

/**
 * Normalize one error text line into a stable dedupe fragment.
 * @param text - raw error text.
 * @returns the normalized line ('' when nothing usable remains).
 */
function normalizeErrorLine(text) {
  const firstLine = text.split('\n', 1)[0]?.replace(/^Error:\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  return firstLine.slice(0, 120)
}
