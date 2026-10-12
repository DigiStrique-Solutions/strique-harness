import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function host() {
  const records = new Map()
  const handlers = new Map()
  const sections = []
  let tool
  let route
  const ctx = {
    storageDomain: {
      async open() {
        return {
          table() {
            return {
              entries: () => records.entries(),
              get: id => records.get(id),
              get size() { return records.size },
              async put(id, value) { records.set(id, value) },
              async delete(id) { return records.delete(id) },
            }
          },
          close() {},
        }
      },
    },
    tools: { register(value) { tool = value; return () => {} } },
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
    on(name, handler) { handlers.set(name, handler); return () => {} },
    effect(register) { register() },
    inject(_services, callback) {
      callback({ connection: { fetch: { register(value) { route = value; return () => {} } } } })
    },
  }
  return { ctx, records, handlers, sections, get tool() { return tool }, get route() { return route } }
}

test('activation teaches the model to save and serves saved memories to the panel', async () => {
  const h = host()
  await apply(h.ctx, {})
  assert.ok(h.sections.some(section => section.text.includes('action: "save"')),
    'memory saving instructions must be in the system prompt')
  assert.ok(h.tool, 'memory tool registered')
  const saved = await h.tool.execute({ action: 'save', kind: 'preference', title: 'Use concise answers', body: 'Keep replies short.' })
  assert.equal(saved.ok, true)
  const response = await h.route.fetch(new Request('http://localhost/api/dsh-mem/memories'))
  const data = await response.json()
  assert.equal(data.stats.total, 1)
  assert.equal(data.memories[0].title, 'Use concise answers')
})

test('failed tool calls become visible observed lessons', async () => {
  const h = host()
  await apply(h.ctx, {})
  h.handlers.get('tools/result')({ name: 'read_file' }, {
    isError: true,
    content: [{ type: 'text', text: 'Error: file missing' }],
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.records.size, 1)
  assert.equal([...h.records.values()][0].status, 'observed')
})
