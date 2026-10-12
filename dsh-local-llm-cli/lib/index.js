/** Cordis provider registration, durable settings, and authenticated status actions. */
import z from '@deepseek-ai/schemastery'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { CodexRuntime } from './runtime.js'

export const name = 'dsh-local-llm-cli'
export const inject = ['llm']
export const PROVIDER = 'local-codex-cli'
export const Config = z.object({
  executablePath: z.string().default('').volatile(),
  workspacePath: z.string().default('').volatile(),
  defaultModel: z.string().default('codex-default').volatile(),
  reasoningEffort: z.union(['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).default('default').volatile(),
  modelIds: z.array(String).default([]).volatile(),
  timeoutMs: z.number().step(1).min(1000).max(3600000).default(300000).volatile(),
  maxPromptBytes: z.number().step(1).min(1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024).volatile(),
  maxOutputBytes: z.number().step(1).min(1024).max(64 * 1024 * 1024).default(4 * 1024 * 1024).volatile(),
  maxToolCalls: z.number().step(1).min(1).max(100).default(16).volatile(),
})

/** A model provider that delegates inference to CodexRuntime rather than HTTP. */
export class CodexAdapter extends LlmAdapter {
  constructor(runtime) { super(); this.runtime = runtime }
  providerInfo() { return { id: PROVIDER, name: 'Codex CLI' } }
  async listModels() {
    let catalog = []
    try { catalog = await this.runtime.catalog() } catch (error) {
      // A missing CLI must not make the whole Harness model selector unusable.
      // Its default alias remains visible; status and inference report the failure.
    }
    const config = this.runtime.getConfig()
    const models = new Map([
      ['codex-default', { provider: PROVIDER, id: 'codex-default', name: 'Codex CLI — configured default', inputModalities: ['text'] }],
      ...catalog.map(model => [model.id, { provider: PROVIDER, id: model.id, name: model.name, inputModalities: ['text'] }]),
    ])
    for (const id of [config.defaultModel, ...config.modelIds].filter(Boolean)) {
      if (!models.has(id)) models.set(id, { provider: PROVIDER, id, name: id, inputModalities: ['text'] })
    }
    return [...models.values()]
  }
  async resolveModel(provider, model, signal, config = this.runtime.getConfig()) {
    try { await this.runtime.catalog(false, signal) } catch (error) {
      if (signal?.aborted) throw error
      // Metadata is advisory; explicit inference reports catalog-independent failures.
    }
    const target = model === 'codex-default' ? config.defaultModel : model
    const found = this.runtime.models.find(item => target === 'codex-default' ? item.isDefault : item.id === target)
    const efforts = found?.efforts ?? []
    const info = { provider, id: model, name: model === 'codex-default' ? 'Codex CLI — configured default' : found?.name ?? model, inputModalities: ['text'] }
    return { ...info, ...(efforts.length ? { reasoning: {
      efforts: efforts.map(id => ({ id, name: id })),
      ...(efforts.includes(config.reasoningEffort) ? { defaultEffort: config.reasoningEffort } : {}),
    } } : {}) }
  }
  async prepareCall(provider, model, signal) {
    const config = structuredClone(this.runtime.getConfig())
    return { model: await this.resolveModel(provider, model, signal, config), stream: options => this.runtime.stream(options, config) }
  }
  stream(options) { return this.runtime.stream(options) }
}

/** Mount the provider and its UI API; every registration belongs to the fiber. */
export function apply(ctx, config) {
  const runtime = new CodexRuntime(() => ({
    executablePath: config.executablePath.get(), workspacePath: config.workspacePath.get(),
    defaultModel: config.defaultModel.get(), reasoningEffort: config.reasoningEffort.get(),
    modelIds: config.modelIds.get(), timeoutMs: config.timeoutMs.get(),
    maxPromptBytes: config.maxPromptBytes.get(), maxOutputBytes: config.maxOutputBytes.get(), maxToolCalls: config.maxToolCalls.get(),
  }))
  ctx.effect(() => () => runtime.dispose())
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], new CodexAdapter(runtime)))
  ctx.on('loader/volatile-update', () => ctx.emit('llm/adapters-updated'))
  ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))
  ctx.inject(['connection'], child => {
    child.effect(() => child.connection.fetch.register({
      path: '/api/dsh-local-llm-cli', methods: ['GET', 'POST'], requestBody: 'buffered',
      async fetch(request) {
        const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
        try {
          if (request.method === 'GET') return json(await runtime.status())
          if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'JSON content type required' }, 415)
          const raw = await request.text()
          if (raw.length > 4096) return json({ error: 'Request body too large' }, 413)
          const body = JSON.parse(raw)
          switch (body.action) {
            case 'refresh': return json(await runtime.status(true))
            case 'login': return json(await runtime.startLogin())
            case 'cancel-login': return json(runtime.cancelLogin())
            case 'logout': await runtime.logout(); return json(await runtime.status())
            default: return json({ error: 'Unknown Codex CLI action' }, 400)
          }
        } catch (error) { return json({ error: error.message ?? 'Codex CLI operation failed' }, 400) }
      },
    }))
  })
}
