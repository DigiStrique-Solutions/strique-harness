import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextButton, SkillsExperience } from '../lib/types/client/experience.js'
import { projectContext } from '../lib/types/context.js'

function view(usage, seq = 1) {
  return { ...projectContext([]), capturedThroughSeq: seq, requests: usage ? [{ seq, turn: 1, step: 1, status: 'settled', usage }] : [], catalogs: { [seq]: [] } }
}
async function mount(request, Component = ContextButton) {
  const dom = new JSDOM('<div id="root"></div>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const root = createRoot(document.getElementById('root'))
  const render = async sessionId => { await act(async () => root.render(createElement(Component, { sessionId, request, Imports: () => null }))) }
  const click = async text => { await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text).click()) }
  await render('first')
  if (Component === ContextButton) await click('Context')
  return { render, click, text: () => document.body.textContent, close: async () => { await act(async () => root.unmount()); dom.window.close() } }
}

test('context renders all disjoint input buckets without counting reasoning twice', async () => {
  for (const [usage, input] of [
    [{ inputTokens: 682, cacheReadTokens: 204416, outputTokens: 100, reasoningTokens: 20, totalTokens: 205198 }, 205098],
    [{ inputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 11, outputTokens: 13, reasoningTokens: 3 }, 23],
    [{ inputTokens: 17, outputTokens: 2 }, 17],
  ]) {
    const ui = await mount(async () => view(usage))
    try { assert.match(ui.text(), new RegExp(`Measured input: ${input};`)); assert.match(ui.text(), new RegExp(`output: ${usage.outputTokens}`)); assert.match(ui.text(), new RegExp(`uncached: ${usage.inputTokens}`)); assert.match(ui.text(), new RegExp(`cache read: ${usage.cacheReadTokens ?? 0}`)) }
    finally { await ui.close() }
  }
})

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
test('context keeps the latest refresh and clears data when the conversation changes', async () => {
  const requests = []
  const ui = await mount((endpoint, payload) => { const pending = deferred(); requests.push({ ...pending, payload }); return pending.promise })
  try {
    await ui.click('Refresh context')
    await act(async () => requests[1].resolve(view(null, 22)))
    await act(async () => requests[0].resolve(view(null, 11)))
    assert.match(ui.text(), /Observed through event 22/)
    assert.doesNotMatch(ui.text(), /event 11/)
    await ui.render('second')
    assert.doesNotMatch(ui.text(), /Observed through event/)
    assert.equal(requests[2].payload.sessionId, 'second')
    await ui.click('Refresh context')
    await act(async () => requests[3].resolve(view(null, 44)))
    await act(async () => requests[2].reject(new Error('stale failure')))
    assert.match(ui.text(), /event 44/)
    assert.doesNotMatch(ui.text(), /stale failure/)
    await ui.click('Refresh context')
    await ui.close()
    await act(async () => requests[4].resolve(view(null, 55)))
  } catch (error) { await ui.close(); throw error }
})


test('preview renders identity and instructions from the same returned definition', async () => {
  const entry = { name: 'alpha', description: 'Old description', path: '/old', sourceIdentity: { origin: '/source', version: 'old-version' }, source: 'runtime', provider: 'runtime', status: 'winner', sourceId: 'source', access: { mode: 'automatic', reason: 'Allowed', rules: [] } }
  const current = { ...entry, description: 'New description', path: '/new', sourceIdentity: { origin: '/source', version: 'new-version' } }
  const request = async endpoint => {
    if (endpoint === 'choices') return { sessions: [{ id: 'first', cwd: '/workspace' }], workspaces: [], presets: [] }
    if (endpoint === 'inventory') return { entries: [entry], sources: [], diagnostics: [], complete: true, migrated: true, writable: true, view: { cwd: '/workspace', preset: 'test' }, counts: { candidates: 1, available: 1, automatic: 1, manual: 0 } }
    if (endpoint === 'detail') return { entry: current, content: 'New instructions', truncated: false, reason: null }
    return view()
  }
  const ui = await mount(request, SkillsExperience)
  try {
    await act(async () => { const select = document.querySelector('[aria-label="Conversation"]'); select.value = 'first'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll('button')].find(button => button.querySelector('strong')?.textContent === 'alpha').click())
    const dialog = document.querySelector('dialog').textContent
    assert.match(dialog, /New instructions/)
    assert.match(dialog, /New description/)
    assert.match(dialog, /new-version/)
    assert.doesNotMatch(dialog, /Old description|old-version/)
  } finally { await ui.close() }
})
