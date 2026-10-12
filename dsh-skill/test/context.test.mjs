import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { projectContext } from '../lib/types/context.js'

test('counts current summaries, unique loaded bodies and occurrences across replay and replacement', () => {
  const session = Session.create(SessionId('context-test'))
  const message = (source, text) => createUserMessage({ source, content: [{ type: 'text', text }] })
  const catalog = session.append('user/message', message({ kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'alpha', description: 'A' }, { name: 'beta', description: 'B' }] }, 'Catalog'), { surfaceOp: 'append' })
  for (let i = 0; i < 2; i++) session.append('user/message', message({ kind: 'skill-invocation', name: 'alpha', form: 'instructions' }, 'Alpha instructions'), { surfaceOp: 'append' })
  let view = projectContext(session.snapshotEvents())
  assert.equal(view.summaryCount, 2)
  assert.equal(view.loadedSkillCount, 1)
  assert.equal(view.loadOccurrenceCount, 2)
  assert.equal(view.loads[0].sourceIdentity, null)
  session.append('user/message', message({ kind: 'skill-catalog', form: 'catalog', entries: [] }, 'No skills available'), { surfaceOp: { op: 'replace', startSeq: catalog.seq, endSeq: catalog.seq }, sourceEventSeqs: [catalog.seq] })
  view = projectContext(session.snapshotEvents())
  assert.equal(view.summaryCount, 0)
  assert.equal(view.loadOccurrenceCount, 2, 'disabling discovery does not erase loaded instructions')
  const resumed = Session.create(SessionId('context-test'), session.snapshotEvents(), session.header)
  assert.deepEqual({ ...projectContext(resumed.snapshotEvents()), capturedThroughSeq: view.capturedThroughSeq }, view)
})

test('records separate settled retries', () => {
  const session = Session.create(SessionId('context-attempts'))
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: {}, tools: [{ name: 'example', description: 'Example', parameters: {} }] }, reason: 'initial' })
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
  const view = projectContext(session.snapshotEvents())
  assert.equal(view.requests.length, 2)
  assert.equal(view.toolsCount, 1)
  assert.equal(view.requests[0].status, 'settled')
  assert.equal(view.requests[1].usage, null)
})

test('large repeated request catalogs stay below the context response limit without losing history', () => {
  const session = Session.create(SessionId('context-large-catalog'))
  const tools = Array.from({ length: 257 }, (_, i) => ({ name: `tool_${i}`, description: 'Synthetic tool documentation. '.repeat(35), parameters: {} }))
  for (let step = 1; step <= 50; step++) {
    session.append('step/start', { turn: step <= 37 ? 1 : 2, step })
    if (step === 1 || step === 38) session.append('request/header', { header: { config: { apiKey: 'DO-NOT-DISCLOSE' }, tools: step === 1 ? tools : tools.slice(25) }, reason: 'changed' })
    session.append('assistant/message', { turn: step <= 37 ? 1 : 2, step, message: { role: 'assistant', content: [] }, stream: [], usage: { inputTokens: step, outputTokens: 1 } }, { surfaceOp: 'append' })
  }
  const view = JSON.parse(JSON.stringify(projectContext(session.snapshotEvents())))
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 1024 * 1024, 'two catalogs and 50 requests must fit below 1 MiB, within the unchanged 4 MiB limit')
  assert.equal(view.requests.length, 50)
  assert.equal(Object.keys(view.catalogs).length, 2)
  assert.equal(view.catalogs[view.requests[0].seq].length, 257)
  assert.equal(view.catalogs[view.requests[49].seq].length, 232)
  assert.equal(view.catalogs[view.requests[0].seq][0].description, tools[0].description)
  assert.equal(view.requests[49].usage.inputTokens, 50)
  assert.equal(view.toolsCount, 232)
  assert.equal(JSON.stringify(view).includes('DO-NOT-DISCLOSE'), false)
})

test('a real SessionStore fork preserves inherited instructions without attributing later parent loads', async () => {
  const ctx = new Context()
  const plugin = ctx.plugin(SessionStore); await plugin
  try {
    const parent = ctx.sessions.create(SessionId('context-parent'))
    const append = name => parent.append('user/message', createUserMessage({ source: { kind: 'skill-invocation', name, form: 'instructions', sourceIdentity: { origin: '/retained' } }, content: [{ type: 'text', text: 'Instructions' }] }), { surfaceOp: 'append' })
    append('inherited')
    const child = ctx.sessions.fork(parent, undefined, SessionId('context-child'))
    append('parent-only')
    const view = projectContext(child.snapshotEvents())
    assert.equal(view.loadedSkillCount, 1)
    assert.equal(view.loads[0].name, 'inherited')
    assert.equal(view.loads[0].sourceIdentity.origin, '/retained')
  } finally { await plugin.dispose() }
})

test('projects model failures, retained sourceIdentity, compaction and an inherited log without leaking request configuration', () => {
  const session = Session.create(SessionId('context-history'))
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { apiKey: 'DO-NOT-DISCLOSE' }, tools: [{ name: 'skill', description: 'Load', parameters: {} }] }, reason: 'initial' })
  session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [], usage: { inputTokens: 30, outputTokens: 2, totalTokens: 32 } }, { surfaceOp: 'append' })
  const results = []
  for (const failed of [false, true]) {
    const callId = failed ? 'failed-call' : 'loaded-call'
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'skill', arguments: JSON.stringify({ name: failed ? 'missing' : 'retained' }) })
    results.push(session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId(callId), isError: failed, content: [{ type: 'text', text: failed ? 'Unavailable' : 'Retained instructions' }] }), meta: { skillSourceIdentity: { origin: '/old-source', version: 'old-version', secret: 'DO-NOT-DISCLOSE' } } }, { surfaceOp: 'append' }))
  }
  let view = projectContext(session.snapshotEvents())
  assert.equal(view.loadedSkillCount, 1)
  assert.equal(view.loads[1].status, 'failed')
  assert.deepEqual(view.loads[0].sourceIdentity, { origin: '/old-source', version: 'old-version' })
  assert.equal(view.requests[0].usage.totalTokens, 32)
  assert.equal(JSON.stringify(view).includes('DO-NOT-DISCLOSE'), false)
  const old = results[0]
  session.append('user/message', createUserMessage({ source: { kind: 'compaction' }, content: [{ type: 'text', text: 'Summary' }] }), { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  view = projectContext(session.snapshotEvents())
  assert.equal(view.loadedSkillCount, 0)
  assert.equal(view.loads[0].status, 'historical')
  // SessionQuery resolves fork ancestry before this projection; a detached copy must preserve attribution.
  assert.deepEqual(projectContext(structuredClone(session.snapshotEvents())), view)
})

test('appended catalogs supersede removed summaries without erasing loaded bodies or history', () => {
  const session = Session.create(SessionId('context-appended-catalogs'))
  const catalog = (entries, text) => session.append('user/message', createUserMessage({ source: { kind: 'skill-catalog', form: 'catalog', entries }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  catalog([{ name: 'old', description: 'Old' }], 'Old catalog retained in log')
  session.append('user/message', createUserMessage({ source: { kind: 'skill-invocation', name: 'old', form: 'instructions' }, content: [{ type: 'text', text: 'Loaded body' }] }), { surfaceOp: 'append' })
  catalog([{ name: 'new', description: 'New' }], 'New catalog')
  let view = projectContext(session.snapshotEvents())
  assert.deepEqual(view.summaries.map(entry => entry.name), ['new'])
  assert.equal(view.textEstimates.summaries, Math.ceil('New catalog'.length / 4))
  catalog([], 'No available skills')
  view = projectContext(session.snapshotEvents())
  assert.equal(view.summaryCount, 0)
  assert.equal(view.loadedSkillCount, 1)
  assert.equal(session.snapshotEvents().filter(event => event.data.source?.kind === 'skill-catalog').length, 3)
})
