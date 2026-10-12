// Isolated installed-artifact browser fixture; no real MCP providers or model calls.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.DSH_HOME, resolve('artifacts/permission-fix/artifacts/release-home'));
const harness = resolve('../deepseek-harness');
const mod = path => import(pathToFileURL(join(harness, path)).href);
const { runProfile } = await mod('apps/cli/src/profile-boot.ts');
const { createLaunchEnvironmentSnapshot } = await mod('packages/util/launch-environment/src/index.ts');
const { createToolResultMessage } = await mod('packages/llm/llm/src/index.ts');
const app = await runProfile({ profile: 'web', patchFiles: [], args: ['--port', '0', '--no-open'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) });
const ctx = app.ctx, base = `http://127.0.0.1:${ctx.webServer.port}`;
const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' });
const cookie = launch.headers.get('set-cookie').split(';')[0], [cookieName, ...cookieValue] = cookie.split('=');
const created = await ctx.sessionController.create({ cwd: resolve('tests/fixtures') });
const { agent } = await ctx.sessionController.resolveAgent(created.sessionId); assert.ok(agent);
ctx.permissionPresets.set(agent.session, 'danger-full-access');
let turn = 0, pending = false;
ctx.webServer.register({ kind: 'prefix', path: '/permission-fixture', async handler(req, res) {
  const reject = ctx.connection.requestRejection(req); if (reject) { res.writeHead(reject); res.end(); return; }
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return json(405, {});
  if (req.url === '/permission-fixture/stop' && !pending) { json(200, { ok: true }); await app.shutdown.shutdown(0); return; }
  if (req.url !== '/permission-fixture/call' || pending) return json(409, {});
  pending = true; const callId = `permission-fix-${++turn}`, toolName = 'mcp__browser_permissions__inspect';
  agent.session.append('turn/start', { turn });
  const event = agent.session.append('tool/call', { turn, step: 1, callId, name: toolName, arguments: '{}' });
  try {
    const result = await ctx.tools.execute({ agent, callId, name: toolName, arguments: {}, signal: AbortSignal.timeout(5000) });
    agent.session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [event.seq] });
    json(200, { isError: result.isError, content: result.content });
  } finally { agent.session.append('turn/end', { turn, reason: { kind: 'completed' } }); pending = false; }
} });
const project = 'dsh-mcp-fingerprint', authDir = join(homedir(), '.codex/browser-auth', project);
mkdirSync(authDir, { recursive: true, mode: 0o700 });
writeFileSync(join(authDir, 'local.json'), JSON.stringify({ cookies: [{ name: cookieName, value: cookieValue.join('='), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' }], origins: [] }), { mode: 0o600 });
writeFileSync(join(homedir(), '.codex/browser-qa/profiles', project + '.json'), JSON.stringify({ project, baseUrl: base, defaultPath: '/' }));
console.log(`READY: isolated permission fixture ${base}`);
