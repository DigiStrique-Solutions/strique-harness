import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, copyFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as plugin from '../lib/index.js'
import { CodexRuntime } from '../lib/runtime.js'
import { compileTools, parseResponse, buildPrompt } from '../lib/bridge.js'
import { findExecutable, runProcess } from '../lib/process.js'

const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-cli-fixture-'))
const executable = join(fixtureDir, 'codex with spaces')
await copyFile(fileURLToPath(new URL('./fake-codex.mjs', import.meta.url)), executable)
await chmod(executable, 0o755)
const config = {
  executablePath: executable, workspacePath: '', defaultModel: 'codex-default', reasoningEffort: 'default', modelIds: [],
  timeoutMs: 5000, maxPromptBytes: 8388608, maxOutputBytes: 4194304, maxToolCalls: 16,
}
const tools = [{ name: 'lookup', description: 'Look up a record', parameters: {
  type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
} }]
const options = (text = 'answer') => ({ provider: plugin.PROVIDER, model: 'codex-default', tools, messages: [{ role: 'user', content: [{ type: 'text', text }] }] })
const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }

test('finds executable paths containing spaces and refuses missing paths', async () => {
  assert.equal(await findExecutable(executable), await realpath(executable))
  await assert.rejects(findExecutable(join(fixtureDir, 'missing')), /missing/)
})
test('discovers paginated models and sanitizes login status', async () => {
  const runtime = new CodexRuntime(() => config)
  try {
    const status = await runtime.status(true)
    assert.equal(status.authMethod, 'chatgpt')
    assert.equal(status.version, 'codex-cli 0.159.2')
    assert.equal(status.models.length, 2)
    assert.deepEqual(status.models[0].efforts, ['low'])
    assert.equal(status.catalogError, undefined)
  } finally { runtime.dispose() }
})
test('returns text and disjoint token usage through the CLI', async () => {
  const runtime = new CodexRuntime(() => config)
  try {
    const chunks = await collect(runtime.stream(options()))
    assert.equal(chunks.find(chunk => chunk.type === 'text-delta').text, 'Fixture answer')
    assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, { inputTokens: 80, outputTokens: 10, cacheReadTokens: 20, totalTokens: 110 })
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally { runtime.dispose() }
})
test('returns a validated tool call with a correlation identity', async () => {
  const runtime = new CodexRuntime(() => config)
  try {
    const chunks = await collect(runtime.stream(options('tool')))
    const delta = chunks.find(chunk => chunk.type === 'tool-call-delta')
    assert.equal(delta.name, 'lookup'); assert.equal(JSON.parse(delta.argumentsDelta).id, 'record-1')
    assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.id, delta.id)
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  } finally { runtime.dispose() }
})
for (const mode of ['invalid', 'native', 'exit', 'malformed-event', 'incomplete']) {
  test(`rejects ${mode} without emitting partial text or calls`, async () => {
    const runtime = new CodexRuntime(() => config)
    try {
      const chunks = await collect(runtime.stream(options(mode)))
      assert.equal(chunks.length, 1)
      assert.equal(chunks[0].reason.kind, 'error')
    } finally { runtime.dispose() }
  })
}
test('request cancellation settles and kills the child', async () => {
  const runtime = new CodexRuntime(() => config), controller = new AbortController()
  const task = collect(runtime.stream({ ...options('hang'), signal: controller.signal }))
  setTimeout(() => controller.abort(), 150)
  try { assert.equal((await task).at(-1).reason.kind, 'aborted') } finally { runtime.dispose() }
})
test('timeouts terminate the child rather than hanging the provider', async () => {
  const runtime = new CodexRuntime(() => ({ ...config, timeoutMs: 150 }))
  try { assert.match((await collect(runtime.stream(options('hang')))).at(-1).reason.failure.message, /timed out/) } finally { runtime.dispose() }
})
test('unloading cancels active calls', async () => {
  const runtime = new CodexRuntime(() => config)
  const task = collect(runtime.stream(options('hang')))
  setTimeout(() => runtime.dispose(), 150)
  assert.equal((await task).at(-1).reason.kind, 'aborted')
})
test('login exposes device code and can be cancelled', async () => {
  const runtime = new CodexRuntime(() => config)
  try {
    await runtime.startLogin()
    await assert.rejects(runtime.startLogin(), /already running/)
    await assert.rejects(runtime.logout(), /Cancel/)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(runtime.login.code, 'ABCD-EFGH')
    assert.equal(runtime.login.url, 'https://auth.openai.com/codex/device')
    runtime.cancelLogin(); await runtime.loginTask
    assert.equal(runtime.login.state, 'cancelled')
  } finally { runtime.dispose() }
})
test('tool names, argument JSON, schema formats, and call limits are checked', () => {
  const validators = compileTools(tools)
  const envelope = (name, args) => JSON.stringify({ text: '', toolCalls: [{ name, arguments: args }] })
  assert.throws(() => parseResponse(envelope('missing', '{}'), validators, 16), /undeclared/)
  assert.throws(() => parseResponse(envelope('lookup', 'bad'), validators, 16))
  assert.throws(() => parseResponse(envelope('lookup', '{"id":2}'), validators, 16), /validation/)
  assert.throws(() => parseResponse(envelope('lookup', '{"id":"ok"}'), validators, 0), /too many/)
  const emails = compileTools([{ name: 'email', parameters: { type: 'string', format: 'email' } }])
  assert.throws(() => parseResponse(envelope('email', '"bad"'), emails, 16), /validation/)
})
test('preserves tool-result identities and rejects image input', () => {
  const prompt = buildPrompt({ ...options(), messages: [{ role: 'tool', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: 'result' }] }] })
  assert.match(prompt, /call-1/)
  assert.throws(() => buildPrompt({ messages: [{ role: 'user', content: [{ type: 'image' }] }] }), /does not support/)
})
test('fails unsupported settings and oversized prompts before inference', async () => {
  const runtime = new CodexRuntime(() => ({ ...config, maxPromptBytes: 1 }))
  try {
    assert.equal((await collect(runtime.stream(options()))).at(-1).reason.kind, 'error')
    assert.match((await collect(runtime.stream({ ...options(), temperature: 1 }))).at(-1).reason.failure.message, /temperature/)
  } finally { runtime.dispose() }
})
test('process output is bounded', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.log("x".repeat(10000))'], { maxBytes: 50 }), /limit/)
})
test('Cordis loads the plugin, advertises models, and streams through Harness', async () => {
  const ctx = new Context()
  const llmFiber = await ctx.plugin(LlmRuntime)
  const fiber = await ctx.plugin(plugin, config)
  try {
    const models = await ctx.llm.listModels(plugin.PROVIDER)
    assert.ok(models.some(model => model.id === 'fixture-model'))
    const chunks = await collect(ctx.llm.stream(options('tool')))
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  } finally { await fiber.dispose(); await llmFiber.dispose() }
})
test('the authenticated API contribution rejects arbitrary actions and owns teardown', async () => {
  const ctx = new Context(), llmFiber = await ctx.plugin(LlmRuntime)
  let route, disposed = false
  ctx.provide('connection', { fetch: { register(value) { route = value; return async () => { disposed = true } } } })
  const fiber = await ctx.plugin(plugin, config)
  try {
    assert.equal(route.path, '/api/dsh-local-llm-cli')
    assert.equal((await route.fetch(new Request('http://localhost/api/dsh-local-llm-cli', { method: 'POST', body: '{}' }))).status, 415)
    const bad = await route.fetch(new Request('http://localhost/api/dsh-local-llm-cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"exec","command":"arbitrary"}' }))
    assert.equal(bad.status, 400)
    const status = await route.fetch(new Request('http://localhost/api/dsh-local-llm-cli'))
    assert.equal((await status.json()).authMethod, 'chatgpt')
  } finally { await fiber.dispose(); await llmFiber.dispose() }
  assert.equal(disposed, true)
})
test.after(async () => { await rm(fixtureDir, { recursive: true, force: true }) })
