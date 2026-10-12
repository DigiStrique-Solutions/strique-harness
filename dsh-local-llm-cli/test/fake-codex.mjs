#!/usr/bin/env node
/** Deterministic CLI fixture; no credentials, network calls, or external tools. */
import { writeFile } from 'node:fs/promises'
import readline from 'node:readline'
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-cli 0.159.2'); process.exit(0) }
if (args[0] === 'login' && args[1] === 'status') { console.error('Logged in using ChatGPT'); process.exit(0) }
if (args[0] === 'logout') process.exit(0)
if (args[0] === 'login') { console.log('https://auth.openai.com/codex/device\nABCD-EFGH'); setInterval(() => {}, 1000) }
else if (args[0] === 'app-server') {
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', line => {
    const message = JSON.parse(line)
    if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: {} }))
    else if (message.method === 'model/list') console.log(JSON.stringify({ id: message.id, result: {
      data: [{ model: message.params.cursor ? 'fixture-second' : 'fixture-model', displayName: 'Fixture model', isDefault: !message.params.cursor, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }],
      nextCursor: message.params.cursor ? null : 'next-page',
    } }))
  })
} else if (args[0] === 'exec') {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input.trim().split('\n').at(-1))
  const mode = payload.messages.at(-1).content[0].text
  if (mode === 'hang') { setInterval(() => {}, 1000) }
  else {
    if (mode === 'native') {
      console.log(JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }))
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (mode === 'exit') process.exit(2)
    if (mode === 'malformed-event') console.log('not-json')
    const envelope = mode === 'invalid' ? { text: 'must not be emitted', toolCalls: [{ name: 'lookup', arguments: '{"id":4}' }] }
      : mode === 'tool' ? { text: '', toolCalls: [{ name: 'lookup', arguments: '{"id":"record-1"}' }] }
        : { text: 'Fixture answer', toolCalls: [] }
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(envelope))
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(envelope) } }))
    if (mode !== 'incomplete') console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } }))
  }
} else process.exit(2)
