import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { apply } from '../lib/index.js';

export async function fixtureServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let bytes = '';
    for await (const part of req) bytes += part;
    const body = bytes ? req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(bytes)) : JSON.parse(bytes) : {};
    requests.push({ method: req.method, body, headers: req.headers, url: req.url });
    if (await handler?.(req, res, body)) return;
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    let result = {};
    if (body.method === 'initialize') result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    if (body.method === 'tools/list') result = { tools: [{ name: 'inspect', description: 'Fixture', inputSchema: { type: 'object', properties: {} } }] };
    if (body.method === 'tools/call') result = { content: [], structuredContent: { amount: 42 } };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export function host(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-test-'));
  const effects = [], tools = new Map(), logs = [], routes = [], guards = [], listeners = new Map();
  const workspacePath = options.workspacePath ?? dir;
  const registry = {
    register(definition) {
      if (tools.has(definition.name)) throw new Error('Duplicate tool');
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
    schemas() { return [...tools.values()].map(d => ({ name: d.name, description: d.description, parameters: d.parameters })); },
    get: name => tools.get(name), guard(fn) { guards.push(fn); const dispose = () => guards.splice(guards.indexOf(fn), 1); effects.push(dispose); return dispose; }, restrict: () => () => {},
    async execute(input) {
      const exec = { signal: new AbortController().signal, callId: 'fixture-call', ...input, token: Symbol('fixture-execution') };
      const hooks = listeners.get('tools/pre-execute') ?? [];
      const next = i => i === hooks.length ? Promise.resolve({ kind: 'allow' }) : hooks[i](exec, () => next(i + 1));
      try {
        const gate = await next(0);
        if (gate.kind !== 'allow') throw new Error(gate.reason || 'Approval required');
        for (const guard of guards) { const reason = guard(exec); if (reason) throw new Error(reason); }
        return await tools.get(exec.name).execute(exec.arguments || {}, exec);
      } finally { for (const fn of listeners.get('tools/result') ?? []) await fn(exec); }
    },
  };
  const agents = {
    async create({ setup }) {
      const agent = { session: { header: { cwd: workspacePath } } };
      agent.ctx = { agent, tools: registry, effect(fn) { const d = fn(); effects.push(d); return d; } };
      await setup?.(agent.ctx, agent); return agent;
    },
    async resume(options) { return this.create(options); },
  };
  const ctx = {
    root: { baseUrl: 'file:///synthetic-profile/' }, tools: registry, agents,
    connection: { requestRejection(req) {
      if (req.headers.host !== '127.0.0.1:3080' || req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3080') return 403;
      return req.headers.cookie === 'fixture-auth' ? undefined : 401;
    } },
    webServer: { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); } },
    get: name => name === 'workspaceRegistry' ? { list: () => [{ path: workspacePath }] } : undefined,
    logger: Object.fromEntries(['info', 'warn', 'error'].map(k => [k, (...args) => logs.push([k, ...args])])),
    effect(fn) { const d = fn(); effects.push(d); return d; },
    on(event, fn) { const list = listeners.get(event) ?? []; list.push(fn); listeners.set(event, list); const dispose = () => list.splice(list.indexOf(fn), 1); effects.push(dispose); return dispose; },
    inject(_deps, fn) { fn(ctx); return { dispose() {} }; },
  };
  if (options.state) {
    mkdirSync(join(dir, 'state'), { mode: 0o700 });
    writeFileSync(join(dir, 'state/state.json'), JSON.stringify(options.state), { mode: 0o600 });
  }
  options.beforeApply?.(ctx, dir);
  apply(ctx, { stateDir: join(dir, 'state'), requestTimeoutMs: 1500, reconnectMaxAttempts: 0, ...options.config });
  async function api(method, path, body, headers = {}) {
    const req = { method, url: `/mcp-manager${path}`, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', cookie: 'fixture-auth', 'content-type': 'application/json', ...headers },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    const res = { status: null, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body = '') { this.body += body; } };
    await routes[0].handler(req, res);
    res.json = () => JSON.parse(res.body);
    return res;
  }
  return { dir, stateDir: join(dir, 'state'), tools, ctx, logs, api,
    async close() { for (const effect of effects.reverse()) if (typeof effect === 'function') await effect(); rmSync(dir, { recursive: true, force: true }); },
  };
}
export async function until(predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for test condition'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
