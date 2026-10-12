/** CLI status, login lifecycle, isolated requests, and model metadata caching. */
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { findExecutable, runProcess, HARDENED_CONFIG, expandPath } from './process.js'
import { RESPONSE_SCHEMA, compileTools, buildPrompt, parseResponse } from './bridge.js'
import { discoverModels } from './catalog.js'

/** Manager owned by the plugin's fiber. In-flight work is cancelled on unload. */
export class CodexRuntime {
  constructor(getConfig) {
    this.getConfig = getConfig
    this.controller = new AbortController()
    this.models = []
    this.catalogPath = ''
    this.login = null
    this.loginController = null
    this.authBusy = false
  }

  dispose() { this.controller.abort(new Error('Codex plugin unloaded')); this.loginController?.abort() }

  async executable(config = this.getConfig()) { return findExecutable(config.executablePath) }

  async catalog(refresh = false, signal) {
    const executable = await this.executable()
    if (signal?.aborted) throw signal.reason
    if (refresh || this.catalogPath !== executable) {
      if (this.catalogPath !== executable) this.models = []
      this.models = await discoverModels(executable, { signal: signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal, timeoutMs: 20000 })
      this.catalogPath = executable
    }
    return this.models
  }

  /** Return classified auth status only; never return raw auth output or credentials. */
  async status(refresh = false) {
    const config = this.getConfig()
    let path
    try { path = await this.executable(config) }
    catch (error) { return { installed: false, authenticated: false, error: error.message, models: [], login: this.login } }
    const [version, auth] = await Promise.all([
      runProcess(path, ['--version'], { signal: this.controller.signal }),
      runProcess(path, ['login', 'status'], { signal: this.controller.signal }),
    ])
    const raw = `${auth.stdout}\n${auth.stderr}`
    let catalogError
    try { await this.catalog(refresh) } catch (error) { catalogError = error.message }
    return {
      installed: true, path, version: version.stdout.trim().match(/codex-cli\s+[\w.+-]+/)?.[0] ?? 'Unknown',
      authenticated: auth.code === 0,
      authMethod: auth.code !== 0 ? 'none' : /ChatGPT/i.test(raw) ? 'chatgpt' : /API key/i.test(raw) ? 'api-key' : 'other',
      models: this.models, catalogError, login: this.login,
    }
  }

  /** Device login exposes only the verification URL and user code, never raw output. */
  async startLogin() {
    if (this.authBusy) throw new Error('A sign-in or logout operation is already running')
    this.authBusy = true
    let executable
    try { executable = await this.executable() } catch (error) { this.authBusy = false; throw error }
    const controller = new AbortController()
    this.loginController = controller
    this.login = { state: 'pending' }
    let buffer = ''
    const capture = chunk => {
      buffer = (buffer + chunk.replace(/\u001b\[[0-9;]*m/g, '')).slice(-16000)
      const url = buffer.match(/https:\/\/auth\.openai\.com\/[a-zA-Z0-9/_-]+/)?.[0]
      const code = buffer.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0]
      if (url) this.login = { state: 'pending', url, ...(code ? { code } : {}) }
    }
    this.loginTask = runProcess(executable, ['login', '--device-auth'], {
      signal: AbortSignal.any([controller.signal, this.controller.signal]), timeoutMs: 15 * 60 * 1000,
      onStdout: capture, onStderr: capture,
    }).then(result => {
      this.login = { state: result.code === 0 ? 'complete' : 'failed' }
    }, () => { this.login = { state: controller.signal.aborted ? 'cancelled' : 'failed' } })
      .finally(() => { this.authBusy = false; this.loginController = null; this.catalogPath = '' })
    return this.login
  }

  cancelLogin() { this.loginController?.abort(); return { state: 'cancelled' } }

  async logout() {
    if (this.authBusy) throw new Error('Cancel the current sign-in before logging out')
    this.authBusy = true
    try {
      const result = await runProcess(await this.executable(), ['logout'], { signal: this.controller.signal })
      if (result.code !== 0) throw new Error('Codex logout failed')
      this.login = null; this.catalogPath = ''
    } finally { this.authBusy = false }
  }

  /** Yield Harness chunks only after validating the entire final response. */
  async *stream(options, config = this.getConfig()) {
    const signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal
    let temp
    try {
      if (signal.aborted) throw signal.reason
      if (options.temperature !== undefined || options.stop?.length) throw new Error('Codex CLI does not support temperature or stop sequences through this adapter')
      const validators = compileTools(options.tools)
      const prompt = buildPrompt(options)
      if (Buffer.byteLength(prompt) > config.maxPromptBytes) throw new Error('Codex request exceeded the configured prompt limit; compact the conversation')
      const executable = await this.executable(config)
      temp = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
      const schemaPath = join(temp, 'response-schema.json'), outputPath = join(temp, 'response.json')
      await writeFile(schemaPath, JSON.stringify(RESPONSE_SCHEMA), { mode: 0o600 })
      const cwd = config.workspacePath.trim() ? expandPath(config.workspacePath.trim()) : temp
      if (!(await stat(cwd)).isDirectory()) throw new Error('The configured workspace is not a directory')
      const model = options.model === 'codex-default' ? config.defaultModel : options.model
      const effort = options.reasoningEffort ?? config.reasoningEffort
      const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
        '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', ...HARDENED_CONFIG,
        ...(model === 'codex-default' ? [] : ['--model', model]),
        ...(effort === 'default' ? [] : ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`]),
        '--output-schema', schemaPath, '--output-last-message', outputPath, '-']
      let usage, completed = false, pending = ''
      const acceptEvent = line => {
        if (!line.trim()) return
        const event = JSON.parse(line)
        if (event.type === 'turn.failed' || event.type === 'error') throw new Error('Codex inference failed; check account limits and model access')
        if (event.type === 'item.started' || event.type === 'item.completed' || event.type === 'item.updated') {
          if (event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)) throw new Error(`Codex attempted a native action: ${event.item.type}; response rejected`)
        }
        if (event.type === 'turn.completed') { completed = true; usage = event.usage }
      }
      const result = await runProcess(executable, args, {
        input: prompt, cwd, signal, timeoutMs: config.timeoutMs, maxBytes: config.maxOutputBytes,
        onStdout(chunk) {
          pending += chunk
          let newline
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
            acceptEvent(line)
          }
        },
      })
      if (pending.trim()) acceptEvent(pending)
      if (result.code !== 0) throw new Error(`Codex CLI exited with code ${result.code ?? result.terminationSignal}; check login, model access, and CLI configuration`)
      if (!completed) throw new Error('Codex exited without completing its turn')
      if ((await stat(outputPath)).size > config.maxOutputBytes) throw new Error('Codex final response exceeded the configured output limit')
      const response = parseResponse(await readFile(outputPath, 'utf8'), validators, config.maxToolCalls)
      let index = 0
      if (response.text) {
        yield { type: 'block-start', index, blockType: 'text' }
        yield { type: 'text-delta', index, text: response.text }
        yield { type: 'block-end', index: index++, block: { type: 'text', text: response.text } }
      }
      for (const call of response.toolCalls) {
        const id = randomUUID()
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments }
        yield { type: 'block-end', index: index++, block: { type: 'tool-call', id, ...call } }
      }
      if (usage && [usage.input_tokens, usage.output_tokens, usage.cached_input_tokens ?? 0].every(n => Number.isSafeInteger(n) && n >= 0) && (usage.cached_input_tokens ?? 0) <= usage.input_tokens) {
        const cache = usage.cached_input_tokens ?? 0
        yield { type: 'usage', usage: { inputTokens: usage.input_tokens - cache, outputTokens: usage.output_tokens, cacheReadTokens: cache, totalTokens: usage.input_tokens + usage.output_tokens } }
      }
      yield { type: 'finish', reason: { kind: response.toolCalls.length ? 'tool-calls' : 'stop' } }
    } catch (error) {
      yield { type: 'finish', reason: { kind: signal.aborted ? 'aborted' : 'error', failure: { code: signal.aborted ? 'ABORTED' : 'CODEX_CLI_ERROR', message: error.message ?? 'Codex CLI request failed' } } }
    } finally { if (temp) await rm(temp, { recursive: true, force: true }) }
  }
}
