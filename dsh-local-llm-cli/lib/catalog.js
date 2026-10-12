/** Query model metadata through the CLI app-server; inference always uses exec. */
import { runProcess, HARDENED_CONFIG } from './process.js'

/** Complete the protocol handshake and paginate the catalog without starting a turn. */
export async function discoverModels(executable, options = {}) {
  let child, pending = '', models = [], nextId = 2
  const send = value => child.stdin.write(`${JSON.stringify(value)}\n`)
  const requestPage = cursor => send({ id: nextId++, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } })
  await runProcess(executable, ['app-server', ...HARDENED_CONFIG], {
    ...options,
    onStart(proc) {
      child = proc
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dsh_local_llm_cli', title: 'DeepSeek Harness Codex CLI', version: '0.1.0' } } })
    },
    onStdout(chunk) {
      pending += chunk
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if (message.id === undefined) continue
        if (message.error) throw new Error('Codex model discovery failed')
        if (message.id === 1) {
          send({ method: 'initialized', params: {} }); requestPage()
        } else {
          if (!Array.isArray(message.result?.data)) throw new Error('Codex returned an invalid model catalog')
          for (const model of message.result.data) {
            if (typeof model.model !== 'string' || typeof model.displayName !== 'string') throw new Error('Codex returned invalid model metadata')
            models.push({ id: model.model, name: model.displayName, isDefault: model.isDefault === true,
              efforts: (model.supportedReasoningEfforts ?? []).map(item => item.reasoningEffort).filter(item => typeof item === 'string') })
          }
          if (models.length > 1000) throw new Error('Codex model catalog exceeded the limit')
          if (message.result.nextCursor) requestPage(message.result.nextCursor)
          else child.stdin.end()
        }
      }
    },
  }).then(result => { if (result.code !== 0) throw new Error('Codex model discovery exited unsuccessfully') })
  return models
}
