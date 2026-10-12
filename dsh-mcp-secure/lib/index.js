import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, watchFile, unwatchFile, openSync, closeSync, fsyncSync, renameSync, unlinkSync, lstatSync, chmodSync, constants } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { JSONRPCMessageSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import Schema from '@deepseek-ai/schemastery';

/** Authenticated, profile-scoped MCP management. See SECURITY.md for trust boundaries. */

const API_PREFIX = '/mcp-manager/api';
const CALLBACK_PATH = '/mcp-manager/callback';
const WORKSPACE_CONFIG_REL = join('.dsh', 'dshmm', 'mcp.json');
const KEEP_SECRET = '__DSH_KEEP_CONFIGURED_SECRET__';

export const name = 'mcp-manager-secure';
export const inject = ['tools', 'webServer', 'connection', 'agents'];
export const Config = Schema.object({
  stateDir: Schema.string(),
  publicOrigin: Schema.string(),
  oauthClientIds: Schema.dict(Schema.string()).default({}),
  maxBodyBytes: Schema.natural().min(1024).default(262144),
  maxResponseBytes: Schema.natural().min(1024).default(8388608),
  maxTools: Schema.natural().min(1).default(1000),
  requestTimeoutMs: Schema.natural().min(100).default(60000),
  reconnectDelayMs: Schema.natural().min(100).default(1000),
  reconnectMaxAttempts: Schema.natural().min(0).default(5),
  oauthTimeoutMs: Schema.natural().min(1000).default(600000),
  approvalTimeoutMs: Schema.natural().min(100).default(300000),
});

function b64url(buf) { return buf.toString('base64url'); }
function canonicalUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use HTTPS, or HTTP on a literal loopback endpoint');
  if (url.username || url.password || url.hash) throw new Error('MCP URLs must not contain credentials or fragments');
  return url.href;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function safeEnvironment(extra = {}) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE']) {
    if (process.env[key] && !process.env[key].startsWith('()')) result[key] = process.env[key];
  }
  return { ...result, ...extra };
}
function secretView(values = {}) { return Object.fromEntries(Object.keys(values).map(key => [key, KEEP_SECRET])); }

export function apply(ctx, options = {}) {
  const config = Config(options);
  const publicOrigin = config.publicOrigin ? new URL(canonicalUrl(config.publicOrigin)) : undefined;
  if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== publicOrigin.origin + '/')) throw new Error('publicOrigin must be an HTTPS origin without a path or query');
  for (const [id, clientId] of Object.entries(config.oauthClientIds)) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[\x21-\x7e]{1,2048}$/.test(clientId)) throw new Error('oauthClientIds must map server IDs to nonempty public OAuth client IDs');
  }
  if (typeof ctx.connection.requestRejection !== 'function') throw new Error('Authenticated Harness Connection service is required');
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  if (!isAbsolute(home)) throw new Error('DSH_HOME must be absolute');
  const profileIdentity = ctx.root?.baseUrl;
  if (!config.stateDir && !profileIdentity) throw new Error('Profile identity or explicit stateDir is required');
  const stateDir = config.stateDir || join(home, 'mcp-manager-secure', createHash('sha256').update(profileIdentity).digest('hex').slice(0, 24));
  if (!isAbsolute(stateDir)) throw new Error('stateDir must be absolute');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (!lstatSync(stateDir).isDirectory() || lstatSync(stateDir).isSymbolicLink()) throw new Error('stateDir must be a real directory');
  chmodSync(stateDir, 0o700);
  const statePath = join(stateDir, 'state.json');
  const lockPath = join(stateDir, 'writer.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error('Invalid state lock');
    const pid = Number(readFileSync(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid state lock owner');
    try { process.kill(pid, 0); throw new Error('This manager state is already in use'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    unlinkSync(lockPath);
    lock = openSync(lockPath, 'wx', 0o600);
  }
  writeFileSync(lock, String(process.pid));
  ctx.effect(() => () => { closeSync(lock); unlinkSync(lockPath); }, 'mcp-manager-state-lock');
  let state;
  try {
    const stat = lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > config.maxResponseBytes) throw new Error('Invalid or oversized manager state');
    const fd = openSync(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { state = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    chmodSync(statePath, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { servers: [], workspaceTokens: {}, workspaceApprovals: {} };
  }
  if (!state || !Array.isArray(state.servers) || state.servers.length > config.maxTools) throw new Error('Invalid manager state schema');
  state.workspaceTokens ??= {};
  state.workspaceApprovals ??= {};
  state.toolPermissions ??= {};
  if (!state.toolPermissions || typeof state.toolPermissions !== 'object' || Array.isArray(state.toolPermissions)) throw new Error('Invalid tool permission state');
  if (!state.workspaceTokens || typeof state.workspaceTokens !== 'object' || Array.isArray(state.workspaceTokens) || !state.workspaceApprovals || typeof state.workspaceApprovals !== 'object' || Array.isArray(state.workspaceApprovals)) throw new Error('Invalid manager credential state');
  if (state.onDemandToolInjection !== true) state.onDemandToolInjection = false;
  let disposed = false;
  const lifecycle = new AbortController();
  const operations = new Set();
  function track(promise) {
    operations.add(promise);
    promise.then(() => operations.delete(promise), () => operations.delete(promise));
    return promise;
  }
  function saveState() {
    if (disposed) throw new Error('MCP manager is shutting down');
    const tmp = join(stateDir, `state-${b64url(randomBytes(12))}.tmp`);
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      const content = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(content) > config.maxResponseBytes) throw new Error('Manager state exceeds limit');
      try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, statePath);
    } catch (error) { try { closeSync(fd); } catch {} try { unlinkSync(tmp); } catch {} throw error; }
  }
  function publicError(error) {
    if (error?.name === 'AbortError') return 'Operation cancelled';
    if (error instanceof UnauthorizedError) return 'Authentication required';
    if (error instanceof OAuthError) return {
      invalid_client_metadata: "The OAuth provider rejected this client's registration. It may require an approved client and registered callback URL. Check the provider's client requirements.",
      invalid_client: 'The OAuth provider rejected this client. Check the provider\'s client requirements.',
      unauthorized_client: 'This client is not authorized by the OAuth provider.',
      invalid_grant: 'Authorization expired or was rejected. Authenticate again.',
      access_denied: 'The OAuth provider denied authorization.',
      invalid_scope: 'The OAuth provider rejected the requested permissions.',
    }[error.errorCode] ?? 'The OAuth provider could not complete authorization. Check its availability and client requirements.';
    // Upstream response bodies, headers and command stderr may contain secrets.
    return 'MCP operation failed. Check server availability and authentication.';
  }

  // serverId -> live connection { sessionId, tools: Map<raw, disposer>, status, error, toolCount }
  const live = new Map();
  // serverId -> pending OAuth flow { state, verifier }
  const pending = new Map();

  // ---- workspace isolation state ----
  // globalServerName -> Set<currently-registered global tool names>. Only these
  // names may be denied via tools.restrict() (restrict rejects unknown names).
  const globalToolsByServer = new Map();
  // canonicalWorkspacePath -> workspace record { path, rawPath, servers: Map<name, wsConn>, agents: Set<agent>, exclude, watcher, error }
  const workspaces = new Map();
  // agent -> { wsPath, disposers: Map<serverName, Array<disposer>>, restrictDisposer }
  const agentScopeState = new Map();
  // canonicalWorkspacePath -> Promise, serializing rescan passes per workspace.
  const workspaceRescans = new Map();

  // Permissions are Host-owned and bound to both the server configuration and
  // the operational tool definition. Documentation never grants access.
  const permissionGrants = new Map();
  const permissionModes = ['allow', 'ask', 'block'];
  // Only traverse JSON Schema positions. Property names and literal values in
  // const, enum, default, examples and extension keywords remain significant.
  function permissionSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
    return Object.fromEntries(Object.entries(schema).filter(([key]) => !['title', 'description'].includes(key)).map(([key, value]) => {
      if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'].includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, permissionSchema(child)]))];
      }
      if (['items', 'prefixItems', 'allOf', 'anyOf', 'oneOf'].includes(key)) return [key, Array.isArray(value) ? value.map(permissionSchema) : permissionSchema(value)];
      if (['additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema'].includes(key)) return [key, permissionSchema(value)];
      return [key, value];
    }));
  }
  function permissionDefinition(tool) {
    const definition = Object.fromEntries(Object.entries(tool).filter(([key]) => !['title', 'description'].includes(key)));
    for (const key of ['inputSchema', 'outputSchema']) if (key in definition) definition[key] = permissionSchema(definition[key]);
    if (definition.annotations) {
      definition.annotations = Object.fromEntries(Object.entries(definition.annotations).filter(([key]) => key !== 'title'));
      if (!Object.keys(definition.annotations).length) delete definition.annotations;
    }
    return definition;
  }
  function toolFingerprint(server, tool) {
    const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
    const definition = [configFingerprint({ ...server, enabled: undefined }), normalize(tool)];
    if (config.oauthClientIds[server.id]) definition.push(config.oauthClientIds[server.id]);
    return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  }
  function permissionRecord(server, tool) {
    const fingerprint = toolFingerprint(server, tool);
    const permissionFingerprint = 'v2:' + toolFingerprint(server, permissionDefinition(tool));
    const key = createHash('sha256').update(`${server.id}\0${tool.name}`).digest('hex');
    let record = state.toolPermissions[key];
    if (!record || record.fingerprint !== fingerprint || record.permissionFingerprint !== permissionFingerprint || !permissionModes.includes(record.mode)) {
      // Legacy records lack the operational fingerprint: migrate only an exact
      // full-definition match. A previous reset or deliberate Ask stays Ask.
      const preserve = record && permissionModes.includes(record.mode) && (record.permissionFingerprint === permissionFingerprint || record.permissionFingerprint === undefined && record.fingerprint === fingerprint);
      record = { serverId: server.id, name: tool.name, fingerprint, permissionFingerprint, mode: preserve ? record.mode : 'ask', reviewRequired: preserve ? record.reviewRequired === true : !!record };
      state.toolPermissions[key] = record;
      saveState();
    }
    return record;
  }
  function permissionTools(server) {
    const found = findServerById(server.id);
    return found?.wsConn ? found.wsConn.tools : live.get(server.id)?.handle?.tools ?? [];
  }
  function permissionView(server) {
    return { serverId: server.id, serverName: server.name, tools: permissionTools(server).map(tool => {
      const record = permissionRecord(server, tool);
      return { name: tool.name, title: String(tool.title || tool.name).slice(0, 200), description: String(tool.description ?? '').slice(0, 2000), fingerprint: record.fingerprint, mode: record.mode, reviewRequired: record.reviewRequired === true, reviewReason: record.reviewRequired ? 'The tool definition or server configuration changed. Review this tool and choose its permission again.' : '' };
    }) };
  }
  function permissionReviewCount(server) {
    return permissionTools(server).filter(tool => permissionRecord(server, tool).reviewRequired).length;
  }
  function permissionTarget(exec) {
    const identity = ctx.tools.get(exec.name, exec.agent)?.mcpPermission;
    if (!identity) return;
    const found = findServerById(identity.serverId);
    const tool = found && permissionTools(found.server).find(t => t.name === identity.name);
    if (!tool || disposed || found.server.enabled === false || found.wsConn && !workspaceApproved(found.server)) return { reason: 'MCP server configuration changed or is unavailable' };
    const record = permissionRecord(found.server, tool);
    if (record.fingerprint !== identity.fingerprint) return { reason: 'MCP tool definition changed; review its permissions again' };
    return { record, server: found.server };
  }
  function permissionDenial(exec, target = permissionTarget(exec)) {
    if (!target) return;
    if (target.reason) return target.reason;
    if (target.record.mode === 'block') return 'This MCP tool is blocked in tool permissions';
    if (permissionGrants.get(exec.token) !== target.record) return 'MCP permission changed or this call has not been approved';
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!ctx.tools.get(exec.name, exec.agent)?.mcpPermission) return next();
    const downstream = await next();
    if (downstream.kind === 'deny') return downstream;
    const target = permissionTarget(exec);
    if (!target?.record) return { kind: 'deny', reason: target?.reason || 'MCP tool became unavailable' };
    if (target.record.mode === 'block') return { kind: 'deny', reason: 'This MCP tool is blocked in tool permissions' };
    if (target.record.mode === 'ask') {
      const approval = ctx.get('approval');
      if (!approval || !exec.agent) return { kind: 'deny', reason: 'This MCP tool requires approval from an active Harness session' };
      const promptsDisabled = approval.effectivePolicy?.(exec.agent.session) === 'never';
      const timeout = AbortSignal.timeout(config.approvalTimeoutMs);
      const signal = AbortSignal.any([exec.signal, lifecycle.signal, timeout]);
      let outcome;
      try {
        outcome = await track(approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.rootCallId ?? exec.callId, reason: `Allow ${exec.name} from ${target.server.name} once? Review the arguments in this tool call. Tool permissions are set to Ask each time.`, signal }));
      } catch { return { kind: 'deny', reason: 'MCP approval is unavailable' }; }
      if (outcome === 'rejected' && promptsDisabled && !signal.aborted) return { kind: 'deny', reason: `This MCP tool is set to Ask each time, but approval prompts are disabled in this session.${target.record.reviewRequired ? ' Its tool definition or server configuration changed and requires renewed approval.' : ''} Review this tool in Settings > MCP (Secure) > Tool permissions, or enable approval prompts.` };
      if (outcome !== 'allowed-once' || signal.aborted) return { kind: 'deny', reason: timeout.aborted ? 'MCP approval timed out' : 'MCP approval was rejected, cancelled, or unavailable' };
    }
    const current = permissionTarget(exec);
    if (!current?.record || current.record !== target.record || disposed || exec.signal.aborted) return { kind: 'deny', reason: 'MCP permissions changed while this call was pending' };
    permissionGrants.set(exec.token, target.record);
    return downstream;
  }, { global: true });
  // A preceding waterfall listener cannot turn Block or an unasked Ask into
  // Allow. Recheck again at transport dispatch after any async scheduler wait.
  ctx.tools.guard(exec => permissionDenial(exec));
  ctx.on('tools/result', exec => { permissionGrants.delete(exec.token); }, { global: true });

  function publicName(serverName, raw) {
    const joined = `mcp__${serverName}__${raw}`;
    const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
    if (normalized.length <= 64) return normalized;
    const hash = createHash('sha256').update(`${serverName}\0${raw}`).digest('hex').slice(0, 12);
    return `${normalized.slice(0, 64 - 13)}_${hash}`;
  }

  async function boundedFetch(input, init = {}, signal = lifecycle.signal, onFinish = () => {}) {
    const url = canonicalUrl(String(input));
    if (typeof init.body === 'string' && Buffer.byteLength(init.body) > config.maxBodyBytes) throw new Error('MCP request exceeds byte limit');
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, init.signal ?? lifecycle.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: combined, redirect: 'error' });
      if (!response.body) { clearTimeout(timer); onFinish(); return response; }
      const eventStream = response.headers.get('content-type')?.split(';')[0] === 'text/event-stream';
      // A notification GET may legitimately stay silent indefinitely. Bound
      // its headers and individual SSE events, not the lifetime of the stream.
      if (eventStream && init.method === 'GET') clearTimeout(timer);
      const reader = response.body.getReader();
      let bytes = 0, newlines = 0;
      const body = new ReadableStream({
        async pull(target) {
          try {
            const { value, done } = await reader.read();
            if (done) { clearTimeout(timer); onFinish(); target.close(); return; }
            if (eventStream) {
              for (const byte of value) {
                if (++bytes > config.maxResponseBytes) throw new Error('MCP event exceeds byte limit');
                if (byte === 10) newlines++; else if (byte !== 13) newlines = 0;
                if (newlines === 2) { bytes = 0; newlines = 0; }
              }
            } else if ((bytes += value.byteLength) > config.maxResponseBytes) throw new Error('MCP response exceeds byte limit');
            target.enqueue(value);
          } catch (error) { clearTimeout(timer); onFinish(); controller.abort(); target.error(error); }
        },
        async cancel(reason) { clearTimeout(timer); onFinish(); try { await reader.cancel(reason); } catch {} finally { controller.abort(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { clearTimeout(timer); onFinish(); throw error; }
  }

  function binding(server) { return canonicalUrl(server.url); }
  function requestOrigin(req) {
    return publicOrigin?.host === req.headers.host ? publicOrigin.origin : `http://${req.headers.host}`;
  }
  function callbackFor(origin, id) { return `${origin}${CALLBACK_PATH}/${id}`; }
  function oauthProvider(server, origin, interactive = false) {
    const resource = binding(server);
    const configuredClientId = config.oauthClientIds[server.id];
    if (server.oauth?.resource !== resource || server.oauth?.configuredClientId !== configuredClientId) delete server.oauth;
    server.oauth ??= { resource, ...(configuredClientId ? { configuredClientId } : {}) };
    const oauth = server.oauth;
    const redirect = origin ? callbackFor(origin, server.id) : oauth.redirect;
    if (oauth.redirect && redirect !== oauth.redirect) {
      delete oauth.client; delete oauth.tokens; delete oauth.discovery;
    }
    if (redirect) oauth.redirect = redirect;
    const valid = () => {
      if (disposed || server.enabled === false || binding(server) !== resource || server.oauth !== oauth || findServerById(server.id)?.server !== server) throw new Error('Authorization configuration changed');
      if (server.wsPath && !workspaceApproved(server)) throw new Error('Workspace configuration requires approval');
    };
    return {
      get redirectUrl() { return redirect; },
      get clientMetadata() { return { client_name: 'Secure MCP Manager', redirect_uris: redirect ? [redirect] : [], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
      state() {
        if (!interactive) throw new UnauthorizedError('Authentication required');
        const flow = { state: b64url(randomBytes(32)), resource, origin, expires: Date.now() + config.oauthTimeoutMs };
        pending.set(server.id, flow);
        return flow.state;
      },
      clientInformation() {
        valid();
        if (!interactive && (!redirect || !configuredClientId && !oauth.client)) throw new UnauthorizedError('Authentication required');
        return configuredClientId ? { client_id: configuredClientId } : oauth.client;
      },
      saveClientInformation(client) { valid(); oauth.client = client; persistServer(server); },
      tokens() { valid(); return oauth.tokens; },
      saveTokens(tokens) { valid(); oauth.tokens = tokens; persistServer(server); },
      redirectToAuthorization(url) {
        valid(); canonicalUrl(url.href);
        const flow = pending.get(server.id);
        if (!interactive || !flow) throw new UnauthorizedError('Authentication required');
        flow.authorizeUrl = url.href;
      },
      saveCodeVerifier(verifier) {
        const flow = pending.get(server.id);
        if (!interactive || !flow) throw new UnauthorizedError('Authentication required');
        flow.verifier = verifier;
      },
      codeVerifier() {
        const flow = pending.get(server.id);
        if (!flow?.verifier || flow.resource !== resource || flow.expires < Date.now()) throw new Error('Authorization expired');
        return flow.verifier;
      },
      discoveryState() { valid(); return oauth.discovery; },
      saveDiscoveryState(discovery) { valid(); oauth.discovery = discovery; persistServer(server); },
      invalidateCredentials(scope) {
        valid();
        if (scope === 'all' || scope === 'client') delete oauth.client;
        if (scope === 'all' || scope === 'tokens') delete oauth.tokens;
        if (scope === 'all' || scope === 'discovery') delete oauth.discovery;
        persistServer(server);
      },
    };
  }
  async function startAuth(server, origin) {
    if (server.enabled === false) throw new Error('Enable this server before authenticating');
    const provider = oauthProvider(server, origin, true);
    // The SDK handles protected-resource discovery, PKCE, resource indicators
    // and dynamic registration, instead of guessing the provider's endpoints.
    try { await auth(provider, { serverUrl: server.url, fetchFn: boundedFetch }); }
    catch (error) { pending.delete(server.id); setServerAuthStatus(server, 'error', publicError(error)); throw error; }
    const flow = pending.get(server.id);
    if (!flow?.authorizeUrl) { pending.delete(server.id); return null; }
    setServerAuthStatus(server, 'authorizing');
    return flow.authorizeUrl;
  }
  async function exchangeCode(server, code, origin) {
    const flow = pending.get(server.id);
    if (!flow || flow.origin !== origin || flow.resource !== binding(server) || flow.expires < Date.now()) throw new Error('Authorization expired or configuration changed');
    try {
      await auth(oauthProvider(server, origin, true), { serverUrl: server.url, authorizationCode: code, fetchFn: boundedFetch });
    } finally { pending.delete(server.id); }
  }
  function resolveHeaders(server) {
    const headers = { ...server.headers };
    for (const [key, envName] of Object.entries(server.headerEnv ?? {})) {
      if (!envName || !process.env[envName]) throw new Error('Required authentication environment variable is missing');
      headers[key] = process.env[envName];
    }
    if (server.tokenEnv) {
      const token = process.env[server.tokenEnv];
      if (!token) throw new Error('Required bearer token environment variable is missing');
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }
  function hasToken(server) {
    // OAuth discovery may show that no authentication is needed. Only explicit
    // missing environment references block a connection before any request.
    try { resolveHeaders(server); return true; } catch { return false; }
  }

  function setLive(serverId, patch) {
    const cur = live.get(serverId) ?? { sessionId: null, tools: new Map(), status: 'disconnected', error: '', toolCount: 0 };
    Object.assign(cur, patch);
    live.set(serverId, cur);
    return cur;
  }

  // Sanitize a server JSON Schema into the raw object form the registry's
  // assertSupportedJsonSchema boundary accepts (same pass-through shape the
  // official dsh-mcp-client uses). Unsupported vocabulary degrades to the
  // annotation-only unconstrained form, which the raw boundary allows.
  const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);
  const isScalar = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
  const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function sanitizeValue(node) {
    if (!isPlainObj(node)) return { description: 'unconstrained JSON value' };
    if (Array.isArray(node.oneOf) && node.oneOf.length >= 2) return { oneOf: node.oneOf.map(sanitizeValue) };
    const t = typeof node.type === 'string' ? node.type : null;
    const out = {};
    if (typeof node.description === 'string') out.description = node.description;
    if (t === 'object') {
      out.type = 'object';
      if (typeof node.additionalProperties === 'boolean') out.additionalProperties = node.additionalProperties;
      if (isPlainObj(node.properties)) {
        out.properties = {};
        for (const k of Object.keys(node.properties)) out.properties[k] = sanitizeValue(node.properties[k]);
        if (Array.isArray(node.required)) {
          const req = node.required.filter((k) => typeof k === 'string' && k in out.properties);
          if (req.length > 0) out.required = req;
        }
      }
    } else if (t === 'array') {
      out.type = 'array';
      if (node.items != null) out.items = sanitizeValue(node.items);
    } else if (t && SCALAR_TYPES.has(t)) {
      out.type = t;
      if (Array.isArray(node.enum)) {
        const vals = node.enum.filter(isScalar);
        if (vals.length > 0) out.enum = vals;
      }
      if (isScalar(node.const)) out.const = node.const;
    } else {
      // Unsupported vocabulary (anyOf/allOf/$ref/pattern/format/bounds/...):
      // degrade to annotation-only — the raw boundary's unconstrained form.
      out.description = out.description ?? 'unconstrained JSON value';
    }
    return out;
  }

  function convParams(schema) {
    const root = sanitizeValue(schema);
    if (root.type !== 'object') {
      return { type: 'object', properties: {} };
    }
    return root;
  }

  const textRender = (_args, value) => {
    const blocks = (value?.content ?? []).map(block => block.type === 'text' ? { type: 'text', text: String(block.text) } : { type: 'text', text: `[MCP ${block.type} content retained in the structured result]` });
    if (value?.isError) blocks.unshift({ type: 'text', text: 'The MCP server reported a tool error.' });
    if (value?.structuredContent !== undefined) blocks.push({ type: 'text', text: JSON.stringify(value.structuredContent) });
    return blocks.length ? blocks : [{ type: 'text', text: 'MCP tool completed with no output.' }];
  };
  const MCP_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      content: { type: 'array', items: { description: 'MCP content block.' } },
      isError: { type: 'boolean' },
      structuredContent: { description: 'Structured MCP result data.' },
    },
    required: ['text', 'content', 'isError'],
  };

  const BROKER_SEARCH_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            server: { type: 'string' },
            tool: { type: 'string' },
            description: { type: 'string' },
            score: { type: 'integer' },
          },
          required: ['name', 'server', 'tool', 'description', 'score'],
        },
      },
    },
    required: ['query', 'matches'],
  };

  const BROKER_DESCRIBE_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      server: { type: 'string' },
      tool: { type: 'string' },
      description: { type: 'string' },
      inputSchema: { description: 'Exact registered JSON Schema for this tool input.' },
    },
    required: ['name', 'server', 'tool', 'description', 'inputSchema'],
  };

  const BROKER_EXECUTE_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: { type: 'array', items: { description: 'DSH content block.' } },
      result: { description: 'Canonical MCP result, including structured data and the server error flag.' },
    },
    required: ['content', 'result'],
  };

  function isMcpToolName(name) {
    return typeof name === 'string' && name.startsWith('mcp__');
  }

  function brokerIdentity(schema, agent) {
    const definition = ctx.tools.get(schema.name, agent);
    if (typeof definition?.mcpServerName === 'string' && typeof definition?.mcpRawName === 'string') {
      return { server: definition.mcpServerName, tool: definition.mcpRawName };
    }
    const rest = schema.name.slice('mcp__'.length);
    const split = rest.indexOf('__');
    if (split < 0) return { server: '', tool: rest };
    return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
  }

  function brokerCatalog(agent) {
    return ctx.tools.schemas(agent)
      .filter((schema) => isMcpToolName(schema.name))
      .map((schema) => ({ schema, ...brokerIdentity(schema, agent) }));
  }

  function brokerJsonRender(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
  }

  function makeBrokerDefinitions(approvedParents) {
    let nestedSeq = 1;
    return [
      {
        name: 'mcp_search_tools',
        description: 'Search MCP tools visible in the current session. Use the exact returned name with mcp_describe_tool or mcp_execute_tool.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Keywords describing the needed capability.' },
            server: { type: 'string', description: 'Optional exact MCP server name.' },
            limit: { type: 'integer', description: 'Optional result count, clamped to 1-20 (default 10).' },
          },
          required: ['query'],
        },
        output: { schema: BROKER_SEARCH_RESULT_SCHEMA, render: brokerJsonRender },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const query = String(args?.query ?? '').trim();
          if (!query) throw new Error('query must not be empty');
          const requestedServer = String(args?.server ?? '').trim().toLocaleLowerCase();
          const requestedLimit = Number.isInteger(args?.limit) ? args.limit : 10;
          const limit = Math.max(1, Math.min(20, requestedLimit));
          const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean))];
          const matches = [];
          for (const entry of brokerCatalog(exec.agent)) {
            if (requestedServer && entry.server.toLocaleLowerCase() !== requestedServer) continue;
            const server = entry.server.toLocaleLowerCase();
            const tool = entry.tool.toLocaleLowerCase();
            const description = String(entry.schema.description ?? '').toLocaleLowerCase();
            let score = 0;
            for (const term of terms) {
              if (server.includes(term)) score += 2;
              if (tool.includes(term)) score += 3;
              if (description.includes(term)) score += 1;
            }
            if (score === 0) continue;
            matches.push({
              name: entry.schema.name,
              server: entry.server,
              tool: entry.tool,
              description: String(entry.schema.description ?? '').slice(0, 300),
              score,
            });
          }
          matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
          return { query, matches: matches.slice(0, limit) };
        },
      },
      {
        name: 'mcp_describe_tool',
        description: 'Return the complete description and exact input schema for one MCP tool visible in the current session.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Exact mcp__<server>__<tool> name returned by mcp_search_tools.' },
          },
          required: ['name'],
        },
        output: { schema: BROKER_DESCRIBE_RESULT_SCHEMA, render: brokerJsonRender },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const name = String(args?.name ?? '').trim();
          const entry = brokerCatalog(exec.agent).find((candidate) => candidate.schema.name === name);
          if (!entry) throw new Error(`MCP tool "${name}" is not visible in this session`);
          return {
            name: entry.schema.name,
            server: entry.server,
            tool: entry.tool,
            description: String(entry.schema.description ?? ''),
            inputSchema: entry.schema.parameters,
          };
        },
      },
      {
        name: 'mcp_execute_tool',
        description: 'Execute one MCP tool visible in the current session by its exact name and arguments.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Exact mcp__<server>__<tool> name.' },
            arguments: { type: 'object', additionalProperties: true, description: 'Arguments matching the tool input schema.' },
          },
          required: ['name', 'arguments'],
        },
        output: {
          schema: BROKER_EXECUTE_RESULT_SCHEMA,
          render: (_args, value) => value.content.length > 0 ? value.content : [{ type: 'text', text: 'MCP tool completed with no output.' }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const name = String(args?.name ?? '').trim();
          if (!brokerCatalog(exec.agent).some((candidate) => candidate.schema.name === name)) {
            throw new Error(`MCP tool "${name}" is not visible in this session`);
          }
          approvedParents.add(exec.token);
          try {
            const result = await ctx.tools.execute({
              callId: `${exec.callId}:mcp:${nestedSeq++}`,
              rootCallId: exec.rootCallId,
              name,
              arguments: args.arguments ?? {},
              agent: exec.agent,
              parent: exec.token,
              signal: exec.signal,
            });
            if (result.isError) throw new Error(result.error?.message ?? 'MCP tool execution failed');
            return { content: result.content, result: result.value };
          } finally {
            approvedParents.delete(exec.token);
          }
        },
      },
    ];
  }

  let brokerRuntimeDispose = null;

  function installBrokerRuntime() {
    const approvedParents = new Set();
    const unsupportedAgents = new WeakSet();
    const warnedUnsupportedAgents = new WeakSet();
    const disposers = [];
    try {
      for (const definition of makeBrokerDefinitions(approvedParents)) {
        disposers.push(ctx.tools.register(definition));
      }
      disposers.push(ctx.tools.guard((exec) => {
        if (!isMcpToolName(exec.name) || exec.agent === undefined || unsupportedAgents.has(exec.agent)) return undefined;
        if (exec.parent !== undefined && approvedParents.has(exec.parent)) return undefined;
        return `direct MCP tool "${exec.name}" is hidden while on-demand MCP tools are enabled; use mcp_execute_tool`;
      }));
      disposers.push(ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        const agent = context.agent ?? context.scope;
        if (!agent || (typeof agent !== 'object' && typeof agent !== 'function')) return assembled;
        const hasCodeSdk = assembled.sections.some((section) => section.name === 'tools:sdk' && section.text.trim() !== '');
        if (hasCodeSdk) {
          unsupportedAgents.add(agent);
          if (!warnedUnsupportedAgents.has(agent)) {
            warnedUnsupportedAgents.add(agent);
            ctx.logger.warn('mcp-manager: on-demand MCP tools require native presentation; keeping the full MCP tool surface for a code/both agent');
          }
          return assembled;
        }
        unsupportedAgents.delete(agent);
        return { ...assembled, tools: assembled.tools.filter((tool) => !isMcpToolName(tool.name)) };
      }, { prepend: true, global: true }));
    } catch (error) {
      for (const dispose of disposers.reverse()) { try { dispose(); } catch {} }
      throw error;
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      approvedParents.clear();
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        try { disposers[index](); } catch {}
      }
    };
  }

  function setOnDemandToolInjection(enabled) {
    if (enabled === state.onDemandToolInjection) return;
    const previous = state.onDemandToolInjection;
    let installed = null;
    if (enabled) installed = installBrokerRuntime();
    state.onDemandToolInjection = enabled;
    try {
      saveState(state);
    } catch (error) {
      state.onDemandToolInjection = previous;
      installed?.();
      throw error;
    }
    if (enabled) brokerRuntimeDispose = installed;
    else {
      brokerRuntimeDispose?.();
      brokerRuntimeDispose = null;
    }
  }

  if (state.onDemandToolInjection) brokerRuntimeDispose = installBrokerRuntime();

  // ---------- stdio transport (JSON-RPC over stdin/stdout, newline-delimited) ----------
  function stdioTransport(server) {
    let child, closed = false, buffer = Buffer.alloc(0), closing;
    const transport = {
      onmessage: null, onclose: null, onerror: null,
      async start() {
        if (child || closed) throw new Error('Transport already started or closed');
        child = spawn(server.command, server.args ?? [], {
          cwd: server.cwd || process.cwd(), env: safeEnvironment(server.env),
          stdio: ['pipe', 'pipe', 'pipe'], shell: false,
          detached: process.platform !== 'win32', windowsHide: true,
        });
        child.stdin.on('error', () => { transport.onerror?.(new Error('MCP stdin failed')); });
        child.stdout.on('data', chunk => {
          try {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > config.maxResponseBytes) throw new Error('MCP message exceeds byte limit');
            let index;
            while ((index = buffer.indexOf(10)) >= 0) {
              const line = buffer.subarray(0, index).toString('utf8').trim();
              buffer = buffer.subarray(index + 1);
              if (line) transport.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line)));
            }
          } catch {
            transport.onerror?.(new Error('Invalid or oversized MCP message'));
            void transport.close();
          }
        });
        // Drain stderr without retaining/logging untrusted credential-bearing output.
        child.stderr.on('data', () => {});
        child.on('close', () => { closed = true; transport.onclose?.(); });
        child.on('error', () => { transport.onerror?.(new Error('MCP process failed')); });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Could not start MCP command'))); });
      },
      async send(message) {
        if (closed || !child?.stdin.writable) throw new Error('MCP process is closed');
        const text = JSON.stringify(message) + '\n';
        if (Buffer.byteLength(text) > config.maxBodyBytes) throw new Error('MCP request exceeds byte limit');
        await new Promise((resolve, reject) => child.stdin.write(text, error => error ? reject(new Error('MCP write failed')) : resolve()));
      },
      close() {
        if (closing) return closing;
        closed = true;
        closing = (async () => {
          if (!child) return;
          const stopped = new Promise(resolve => child.once('close', resolve));
          if (child.pid) {
            if (process.platform === 'win32') {
              const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { env: safeEnvironment(), stdio: 'ignore', shell: false });
              await new Promise(resolve => { killer.once('close', resolve); killer.once('error', resolve); });
            } else {
              try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
              let timer;
              await Promise.race([stopped, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
              clearTimeout(timer);
              // The leader may exit before its descendants; kill any remaining
              // members of this owned process group even after leader exit.
              try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
            }
          }
          if (child.exitCode === null && child.signalCode === null) await stopped;
          buffer = Buffer.alloc(0);
        })();
        return closing;
      },
    };
    return transport;
  }

  // Build one tool definition from a tools/list entry. Shared by the global
  // (profile) tier and the per-workspace (scoped) tier. callFn(toolName, args)
  // resolves to the raw tools/call result.
  function makeToolDefinition(server, tool, callFn) {
    const record = permissionRecord(server, tool);
    return {
      name: publicName(server.name, tool.name),
      mcpServerName: server.name,
      mcpRawName: tool.name,
      mcpPermission: Object.freeze({ serverId: server.id, name: tool.name, fingerprint: record.fingerprint }),
      description: `${tool.description ?? ''} [${server.name} MCP]`.slice(0, 2000),
      parameters: convParams(tool.inputSchema),
      output: { schema: MCP_RESULT_SCHEMA, render: textRender },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const target = permissionTarget(exec);
        const denial = exec.name !== publicName(server.name, tool.name) || !target ? 'MCP calls must pass through the Harness permission pipeline' : permissionDenial(exec, target);
        permissionGrants.delete(exec.token);
        if (denial) throw new Error(denial);
        const r = await callFn(tool.name, args ?? {}, exec.signal);
        const content = Array.isArray(r?.content) ? r.content : [];
        const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
        return { text, content, isError: r?.isError === true, ...(r?.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}) };
      },
    };
  }

  function registrationSignature(definition) {
    return JSON.stringify({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      permission: definition.mcpPermission,
    });
  }

  function disposeRegistrations(registrations) {
    for (const entry of registrations.values()) { try { entry.dispose(); } catch {} }
    registrations.clear();
  }

  // Preserve registrations whose model-facing schema did not change. Besides
  // keeping prompt caches stable, this avoids transiently removing unrelated
  // tools when a server emits notifications/tools/list_changed.
  function syncToolRegistrations(toolsRegistry, server, registrations, tools, callFn) {
    const desired = new Map();
    const publicNames = new Set();
    for (const tool of tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) throw new Error(`MCP server "${server.name}" returned a tool without a name`);
      if (desired.has(tool.name)) throw new Error(`MCP server "${server.name}" returned duplicate tool "${tool.name}"`);
      const definition = makeToolDefinition(server, tool, callFn);
      if (publicNames.has(definition.name)) throw new Error(`MCP server "${server.name}" returned tools that normalize to duplicate name "${definition.name}"`);
      publicNames.add(definition.name);
      desired.set(tool.name, { definition, signature: registrationSignature(definition) });
    }

    const previous = new Map();
    for (const [rawName, current] of registrations) {
      const next = desired.get(rawName);
      if (next && next.signature === current.signature) continue;
      previous.set(rawName, current);
      try { current.dispose(); } catch {}
      registrations.delete(rawName);
    }

    const added = [];
    try {
      for (const [rawName, next] of desired) {
        if (registrations.has(rawName)) continue;
        const entry = { ...next, dispose: toolsRegistry.register(next.definition) };
        registrations.set(rawName, entry);
        added.push(rawName);
      }
    } catch (error) {
      for (const rawName of added) {
        const entry = registrations.get(rawName);
        try { entry?.dispose(); } catch {}
        registrations.delete(rawName);
      }
      const restoreFailures = [];
      for (const [rawName, entry] of previous) {
        try {
          entry.dispose = toolsRegistry.register(entry.definition);
          registrations.set(rawName, entry);
        } catch (restoreError) {
          restoreFailures.push(`${rawName}: ${restoreError?.message ?? restoreError}`);
        }
      }
      if (restoreFailures.length > 0) {
        throw new Error(`${error?.message ?? error}; rollback failed for ${restoreFailures.join(', ')}`);
      }
      throw error;
    }
    return [...desired.values()].map((entry) => entry.definition.name);
  }

  // Register a connected server's tools into the GLOBAL (profile-level) registry.
  function registerToolsGlobal(server, conn, tools) {
    const call = (name, args, signal) => {
      if (!conn.handle) return Promise.reject(new Error(`MCP server "${server.name}" is not connected`));
      return conn.handle.call(name, args, signal);
    };
    const names = syncToolRegistrations(ctx.tools, server, conn.tools, tools, call);
    conn.toolCount = tools.length;
    conn.status = 'connected';
    conn.error = '';
    setGlobalTools(server.name, names);
    ctx.logger.info(`mcp-manager: ${server.name} connected, ${tools.length} tools`);
  }

  // Track the exact global tool names owned by one global server so workspace
  // `exclude` masking can deny them (restrict() accepts only known global names).
  function setGlobalTools(serverName, names) {
    const set = new Set(names);
    const previous = globalToolsByServer.get(serverName);
    if (previous && previous.size === set.size && [...set].every((name) => previous.has(name))) return;
    if (set.size > 0) globalToolsByServer.set(serverName, set);
    else globalToolsByServer.delete(serverName);
    reconcileRestrictions(serverName);
  }

  function clearGlobalTools(serverName) {
    if (!globalToolsByServer.has(serverName)) return;
    globalToolsByServer.delete(serverName);
    reconcileRestrictions(serverName);
  }

  async function listAllTools(handle) {
    const tools = [];
    const seenCursors = new Set();
    let cursor;
    do {
      const listed = await handle.listTools(cursor);
      if (!Array.isArray(listed?.tools)) throw new Error('MCP tools/list returned no tools array');
      if (tools.length + listed.tools.length > config.maxTools || seenCursors.size >= config.maxTools) throw new Error('MCP tool discovery exceeds limit');
      tools.push(...listed.tools);
      const next = typeof listed.nextCursor === 'string' && listed.nextCursor ? listed.nextCursor : undefined;
      if (next && seenCursors.has(next)) throw new Error(`MCP tools/list repeated cursor "${next}"`);
      if (next) seenCursors.add(next);
      cursor = next;
    } while (cursor !== undefined);
    return tools;
  }

  // Each connection owns one SDK client, transport, cancellation signal and
  // complete tool generation. Calls are never retried automatically.
  async function openServer(server, parentSignal = lifecycle.signal, onFailure = () => {}) {
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, lifecycle.signal, controller.signal]);
    const client = new Client({ name: 'dsh-mcp-manager-secure', version: '0.9.1' });
    const handle = { client, controller, closed: false, tools: [], onNotification: null, closePromise: null,
      async close() {
        if (handle.closePromise) return handle.closePromise;
        handle.closed = true;
        handle.closePromise = Promise.resolve().then(() => client.close()).catch(() => {});
        controller.abort();
        return handle.closePromise;
      },
    };
    const inFlight = new Map();
    const fetchForServer = (input, init = {}) => {
      const target = canonicalUrl(String(input));
      const headers = new Headers(init.headers);
      if (target === binding(server)) {
        for (const [key, value] of Object.entries(resolveHeaders(server))) headers.set(key, value);
      }
      const message = target === binding(server) && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (message?.method === 'notifications/cancelled') inFlight.get(message.params?.requestId)?.abort();
      const requestController = new AbortController();
      if (message?.id !== undefined) inFlight.set(message.id, requestController);
      return boundedFetch(target, { ...init, headers }, AbortSignal.any([signal, requestController.signal]), () => {
        if (message?.id !== undefined && inFlight.get(message.id) === requestController) inFlight.delete(message.id);
      });
    };
    const transport = server.type === 'stdio' ? stdioTransport(server) : new StreamableHTTPClientTransport(new URL(binding(server)), {
      ...(server.authMode === 'oauth' ? { authProvider: oauthProvider(server) } : {}),
      fetch: fetchForServer,
      reconnectionOptions: { maxReconnectionDelay: config.reconnectDelayMs * 8, initialReconnectionDelay: config.reconnectDelayMs, reconnectionDelayGrowFactor: 2, maxRetries: config.reconnectMaxAttempts },
    });
    handle.transport = transport;
    const abort = () => { if (!handle.closed) void handle.close(); };
    signal.addEventListener('abort', abort, { once: true });
    const failed = error => { if (handle.ready && !handle.closed && !signal.aborted && error?.name !== 'AbortError') onFailure(); };
    client.onclose = failed;
    client.onerror = failed;
    client.setNotificationHandler(ToolListChangedNotificationSchema, message => handle.onNotification?.(message));
    const requestOptions = extra => ({ timeout: config.requestTimeoutMs, signal: extra ? AbortSignal.any([signal, extra]) : signal });
    try {
      signal.throwIfAborted();
      await client.connect(transport, requestOptions());
      handle.listTools = cursor => client.listTools(cursor === undefined ? {} : { cursor }, requestOptions());
      handle.tools = await listAllTools(handle);
      handle.ready = true;
      handle.call = async (name, args, executionSignal) => {
        signal.throwIfAborted(); executionSignal?.throwIfAborted();
        try { return await client.callTool({ name, arguments: args }, undefined, requestOptions(executionSignal)); }
        catch (error) {
          if (!executionSignal?.aborted && !signal.aborted && !(error?.code === -32602)) onFailure();
          throw new Error(executionSignal?.aborted ? 'MCP call cancelled' : publicError(error));
        }
      };
      const close = handle.close.bind(handle);
      handle.close = async () => { signal.removeEventListener('abort', abort); await close(); };
      return handle;
    } catch (error) { signal.removeEventListener('abort', abort); await handle.close(); throw error; }
  }

  function bindToolsChanged(server, handle, refresh) {
    let running = false, queued = false;
    handle.onNotification = () => {
      queued = true;
      if (running || handle.closed) return;
      track((async () => {
        running = true;
        try { do { queued = false; await refresh(); } while (queued && !handle.closed && !disposed); }
        catch { ctx.logger.warn(`mcp-manager: could not refresh tools for ${server.name}`); }
        finally { running = false; }
      })());
    };
  }

  function enabledGlobal(server) { return !disposed && server.enabled !== false && state.servers.includes(server); }
  const globalEpochs = new Map();
  async function disconnect(serverId, invalidate = true) {
    if (invalidate) globalEpochs.set(serverId, (globalEpochs.get(serverId) ?? 0) + 1);
    const conn = live.get(serverId);
    if (!conn) return;
    live.delete(serverId);
    clearTimeout(conn.retryTimer);
    conn.controller?.abort();
    disposeRegistrations(conn.tools);
    if (conn.name) clearGlobalTools(conn.name);
    await conn.handle?.close();
    if (conn.pending) await conn.pending;
  }
  async function connect(server, attempt = 0) {
    const epoch = (globalEpochs.get(server.id) ?? 0) + 1;
    globalEpochs.set(server.id, epoch);
    await disconnect(server.id, false);
    if (!enabledGlobal(server) || globalEpochs.get(server.id) !== epoch) return;
    const controller = new AbortController();
    const conn = setLive(server.id, { name: server.name, status: 'connecting', error: '', controller, attempt });
    const current = () => enabledGlobal(server) && live.get(server.id) === conn && !controller.signal.aborted;
    const fail = () => {
      if (!current() || conn.failed) return;
      conn.failed = true;
      disposeRegistrations(conn.tools); clearGlobalTools(server.name);
      conn.toolCount = 0; conn.status = 'error'; conn.error = 'Connection lost';
      if (attempt < config.reconnectMaxAttempts) conn.retryTimer = setTimeout(() => { track(connect(server, attempt + 1)); }, config.reconnectDelayMs * Math.min(2 ** attempt, 8));
      void conn.handle?.close();
    };
    conn.pending = track((async () => {
      try {
        const handle = await openServer(server, controller.signal, fail);
        if (!current() || conn.failed) { await handle.close(); return; }
        conn.handle = handle;
        registerToolsGlobal(server, conn, handle.tools);
        bindToolsChanged(server, handle, async () => {
          const tools = await listAllTools(handle);
          if (!current() || handle.closed) return;
          handle.tools = tools; registerToolsGlobal(server, conn, tools);
        });
      } catch (error) {
        if (!current()) return;
        conn.status = error instanceof UnauthorizedError ? 'needs-auth' : 'error';
        conn.error = publicError(error);
        if (!(error instanceof UnauthorizedError)) fail();
      }
    })());
    await conn.pending;
    return conn;
  }

  // ---------- workspace (per-workspace) MCP isolation ----------

  function wsConfigPath(cwd) {
    return join(cwd, WORKSPACE_CONFIG_REL);
  }

  function canonicalize(cwd) {
    try { return realpathSync(cwd); } catch { return cwd; }
  }

  function knownWorkspacePath(path) {
    if (!isAbsolute(path)) return null;
    let canonical;
    try { canonical = realpathSync(path); } catch { return null; }
    if (workspaces.has(canonical)) return canonical;
    const registry = ctx.get('workspaceRegistry');
    if (!registry || typeof registry.list !== 'function') return null;
    return registry.list().some((ws) => typeof ws?.path === 'string' && canonicalize(ws.path) === canonical) ? canonical : null;
  }

  // Stable, deterministic server id derived from (canonical workspace, name) so
  // an OAuth callback can re-locate the server across config rescans.
  function workspaceServerId(wsPath, name) {
    return `ws-${createHash('sha256').update(`${wsPath}\n${name}`).digest('hex').slice(0, 20)}`;
  }

  function workspaceTokenKey(wsPath, name) {
    return `${wsPath}\n${name}`;
  }

  // Persist OAuth client registration + tokens for one server, routing to the
  // global state or the per-workspace token slot depending on where it lives.
  function persistServer(server) {
    if (server.wsPath) {
      const key = workspaceTokenKey(server.wsPath, server.name);
      if (server.oauth) state.workspaceTokens[key] = { resource: binding(server), oauth: server.oauth };
      else delete state.workspaceTokens[key];
    }
    saveState(state);
  }

  // Set a server's auth/connection status in whichever tier it belongs to.
  function setServerAuthStatus(server, status, error = '') {
    if (server.wsPath) {
      const ws = workspaces.get(server.wsPath);
      const wc = ws?.servers.get(server.name);
      if (wc) { wc.status = status; wc.error = error; }
    } else {
      setLive(server.id, { status, error });
    }
  }

  // Resolve a server by its (globally unique) id across both tiers.
  function findServerById(id) {
    const g = state.servers.find((s) => s.id === id);
    if (g) return { server: g, wsPath: null, wsConn: null };
    for (const [wsPath, ws] of workspaces) {
      for (const wc of ws.servers.values()) {
        if (wc.server.id === id) return { server: wc.server, wsPath, wsConn: wc };
      }
    }
    return null;
  }

  function normalizeWorkspaceServer(name, cfg, cwd) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) return null;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    const type = cfg.type === 'stdio' ? 'stdio' : 'http';
    if (type === 'stdio') {
      const command = String(cfg.command ?? '').trim();
      if (!command) return null;
      const server = { id: `ws-${b64url(randomBytes(8))}`, name, type: 'stdio', command, args: parseArgs(cfg.args), env: parseEnv(cfg.env), enabled: cfg.enabled !== false };
      const wcwd = String(cfg.cwd ?? '').trim();
      server.cwd = canonicalize(wcwd || cwd);
      return server;
    }
    const url = canonicalUrl(String(cfg.url ?? '').trim());
    const authMode = cfg.authMode === 'static' ? 'static' : 'oauth';
    const server = { id: `ws-${b64url(randomBytes(8))}`, name, type: 'http', url, authMode, headers: parseEnv(cfg.headers), headerEnv: parseEnv(cfg.headerEnv), enabled: cfg.enabled !== false };
    if (authMode === 'static') server.tokenEnv = String(cfg.tokenEnv ?? '').trim();
    return server;
  }

  function readWorkspaceJson(cwd) {
    const path = wsConfigPath(cwd);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > config.maxBodyBytes) throw new Error('Workspace MCP config must be a bounded regular file');
    const canonical = realpathSync(path);
    if (!canonical.startsWith(realpathSync(cwd) + '/')) throw new Error('Workspace config escapes its workspace');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
  }

  function readWorkspaceConfig(cwd) {
    try {
      const raw = readWorkspaceJson(cwd);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('root must be a JSON object');
      const mcpServers = raw?.mcpServers;
      const servers = [];
      if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
        for (const [name, cfg] of Object.entries(mcpServers)) {
          const server = normalizeWorkspaceServer(name, cfg, cwd);
          if (!server) throw new Error('Invalid MCP server definition');
          if (servers.length >= config.maxTools) throw new Error('Too many workspace servers');
          servers.push(server);
        }
      }
      const exclude = Array.isArray(raw?.exclude) ? raw.exclude.filter((x) => typeof x === 'string') : [];
      return { servers, exclude, error: '' };
    } catch (error) {
      if (error?.code === 'ENOENT') return { servers: [], exclude: [], error: '' };
      return { servers: [], exclude: [], error: `Invalid ${WORKSPACE_CONFIG_REL}; check its JSON, field types, size and location.` };
    }
  }

  // Read/write the raw workspace config object (preserving mcpServers entries).
  function readWorkspaceRaw(cwd) {
    try {
      const raw = readWorkspaceJson(cwd);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('root must be a JSON object');
      return raw;
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw new Error(`invalid ${WORKSPACE_CONFIG_REL}: ${error?.message ?? error}`);
    }
  }

  function writeWorkspaceRaw(cwd, raw) {
    const root = realpathSync(cwd), path = wsConfigPath(root), parent = dirname(path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (!realpathSync(parent).startsWith(root + '/')) throw new Error('Workspace config directory escapes its workspace');
    try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Workspace config must be a regular file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = JSON.stringify(raw, null, 2) + '\n';
    if (Buffer.byteLength(content) > config.maxBodyBytes) throw new Error('Workspace config exceeds limit');
    const temporary = join(parent, `.mcp-${b64url(randomBytes(12))}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, path);
    } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  }

  // Normalize + validate a flat server payload (from the Settings form) into a
  // Claude/Codex-style `mcpServers[name]` entry. Returns { name, entry } or { error }.
  function buildWorkspaceEntry(body, previous = {}) {
    const name = String(body?.name ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return { error: 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)' };
    const type = body?.type === 'stdio' ? 'stdio' : 'http';
    const entry = { type, enabled: body.enabled !== false };
    if (type === 'stdio') {
      const command = String(body?.command ?? '').trim();
      if (!command) return { error: 'stdio server requires a command (executable, e.g. npx / uvx / python)' };
      entry.command = command;
      entry.args = parseArgs(body?.args);
      entry.env = parseEnv(body?.env, previous.env);
      const cwd = String(body?.cwd ?? '').trim();
      if (cwd) entry.cwd = cwd;
    } else {
      let url;
      try { url = canonicalUrl(String(body?.url ?? '').trim()); } catch (error) { return { error: error.message }; }
      entry.url = url;
      entry.authMode = body?.authMode === 'static' ? 'static' : 'oauth';
      entry.headers = parseEnv(body?.headers, previous.headers);
      entry.headerEnv = parseEnv(body?.headerEnv);
      if (entry.authMode === 'static') entry.tokenEnv = String(body?.tokenEnv ?? '').trim();
    }
    return { name, entry };
  }

  function configFingerprint(server) {
    const fields = ['name', 'type', 'url', 'authMode', 'tokenEnv', 'headers', 'headerEnv', 'command', 'args', 'env', 'cwd', 'enabled'];
    const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
    const value = Object.fromEntries(fields.filter(key => server[key] !== undefined).map(key => [key, server[key]]));
    return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
  }
  function sameServerConfig(a, b) { return configFingerprint(a) === configFingerprint(b); }
  function workspaceApproved(server) {
    if (disposed || server.enabled === false) return false;
    const approval = state.workspaceApprovals[workspaceTokenKey(server.wsPath, server.name)];
    if (approval !== configFingerprint(server)) return false;
    const cfg = readWorkspaceConfig(server.wsPath);
    return !cfg.error && cfg.servers.some(current => current.name === server.name && configFingerprint(current) === approval);
  }
  function approveWorkspaceEntry(path, name, expectedFingerprint) {
    const cfg = readWorkspaceConfig(path);
    const server = cfg.servers.find(candidate => candidate.name === name);
    if (cfg.error || !server || configFingerprint(server) !== expectedFingerprint) throw new Error('Configuration changed; review the current definition again');
    state.workspaceApprovals[workspaceTokenKey(path, name)] = expectedFingerprint;
    saveState();
  }

  // A server name is globally unique across the global tier and every workspace.
  function serverNameTaken(name, exceptWsPath) {
    if (state.servers.some((s) => s.name === name)) return true;
    for (const [path, other] of workspaces) {
      if (path === exceptWsPath) continue;
      for (const otherName of other.servers.keys()) if (otherName === name) return true;
    }
    return false;
  }

  async function openWorkspaceServer(server) {
    const wsConn = { server, handle: null, controller: new AbortController(), status: 'connecting', error: '', toolCount: 0, tools: [], retryAttempt: 0, call: () => Promise.reject(new Error('not connected')) };
    workspaces.get(server.wsPath)?.servers.set(server.name, wsConn);
    if (server.enabled === false) { wsConn.status = 'disabled'; return wsConn; }
    if (!workspaceApproved(server)) { wsConn.status = 'pending-approval'; return wsConn; }
    return openWorkspaceServerInner(server, wsConn);
  }
  async function openWorkspaceServerInner(server, wsConn) {
    try {
      const fail = () => {
        if (disposed || wsConn.controller.signal.aborted || wsConn.status === 'error') return;
        wsConn.status = 'error'; wsConn.error = 'Connection lost'; wsConn.tools = []; wsConn.toolCount = 0;
        const ws = workspaces.get(server.wsPath);
        if (ws) for (const agent of ws.agents) rebuildAgentWorkspace(agent, server.wsPath);
        void wsConn.handle?.close();
        if (wsConn.retryAttempt < config.reconnectMaxAttempts) {
          const attempt = ++wsConn.retryAttempt;
          wsConn.retryTimer = setTimeout(() => {
            if (disposed || wsConn.controller.signal.aborted || !workspaceApproved(server)) return;
            wsConn.status = 'connecting';
            track(openWorkspaceServerInner(server, wsConn).then(() => { if (ws) for (const agent of ws.agents) rebuildAgentWorkspace(agent, server.wsPath); }));
          }, config.reconnectDelayMs * Math.min(2 ** attempt, 8));
        }
      };
      const handle = await openServer(server, wsConn.controller.signal, fail);
      if (disposed || wsConn.controller.signal.aborted || !workspaceApproved(server)) { await handle.close(); wsConn.status = 'pending-approval'; return wsConn; }
      wsConn.handle = handle; wsConn.tools = handle.tools; wsConn.toolCount = handle.tools.length;
      for (const tool of wsConn.tools) permissionRecord(server, tool);
      wsConn.status = 'connected'; wsConn.error = '';
      wsConn.call = (name, args, signal) => handle.call(name, args, signal);
      bindToolsChanged(server, handle, async () => {
        const tools = await listAllTools(handle);
        if (wsConn.handle !== handle || handle.closed || !workspaceApproved(server)) return;
        wsConn.tools = tools; wsConn.toolCount = tools.length;
        for (const tool of tools) permissionRecord(server, tool);
        const ws = workspaces.get(server.wsPath);
        if (ws?.servers.get(server.name) === wsConn) for (const agent of ws.agents) rebuildAgentWorkspace(agent, server.wsPath);
      });
    } catch (error) {
      wsConn.status = error instanceof UnauthorizedError ? 'needs-auth' : 'error';
      wsConn.error = publicError(error);
    }
    return wsConn;
  }
  async function closeWorkspaceServer(wsConn) {
    clearTimeout(wsConn.retryTimer); wsConn.controller?.abort();
    await wsConn.handle?.close();
    wsConn.handle = null; wsConn.call = () => Promise.reject(new Error('not connected'));
  }

  function registerWorkspaceTools(agent, wsPath, server, wsConn, registrations) {
    const call = (name, args, signal) => {
      const current = workspaces.get(wsPath)?.servers.get(server.name);
      if (!current || current.status !== 'connected') return Promise.reject(new Error(`workspace MCP server "${server.name}" is not connected`));
      if (!workspaceApproved(current.server)) throw new Error('Workspace configuration changed; review and approve it again');
      return current.call(name, args, signal);
    };
    syncToolRegistrations(agent.ctx.tools, server, registrations, wsConn.tools, call);
  }

  function disposeAgentScope(st) {
    for (const registrations of st.disposers.values()) disposeRegistrations(registrations);
    st.disposers.clear();
    if (st.restrictDisposer) { try { st.restrictDisposer(); } catch {} st.restrictDisposer = undefined; }
    st.restrictKey = undefined;
  }

  function reconcileRestrictForAgent(agent, ws, st) {
    const deny = [];
    for (const serverName of ws.exclude ?? []) {
      const tools = globalToolsByServer.get(serverName);
      if (tools) for (const t of tools) deny.push(t);
    }
    deny.sort();
    const restrictKey = JSON.stringify(deny);
    if (st.restrictKey === restrictKey) return;
    if (st.restrictDisposer) { try { st.restrictDisposer(); } catch {} st.restrictDisposer = undefined; }
    st.restrictKey = restrictKey;
    if (deny.length === 0) return;
    try {
      st.restrictDisposer = agent.ctx.tools.restrict({ deny });
    } catch (error) {
      throw new Error('Workspace MCP restriction could not be installed', { cause: error });
    }
  }

  // Re-evaluate every live agent's mask after a global tool-set change or an
  // `exclude` edit. `_serverName` is informational (which global server changed).
  function reconcileRestrictions(_serverName) {
    for (const [agent, st] of agentScopeState) {
      const ws = workspaces.get(st.wsPath);
      if (!ws) continue;
      reconcileRestrictForAgent(agent, ws, st);
    }
  }

  function rebuildAgentWorkspace(agent, wsPath) {
    const ws = workspaces.get(wsPath);
    let st = agentScopeState.get(agent);
    if (st && st.wsPath !== wsPath) {
      disposeAgentScope(st);
      agentScopeState.delete(agent);
      st = undefined;
    }
    if (!ws) {
      if (st) { disposeAgentScope(st); agentScopeState.delete(agent); }
      return;
    }
    if (!st) {
      st = { wsPath, disposers: new Map(), restrictDisposer: undefined, restrictKey: undefined };
      agentScopeState.set(agent, st);
    }
    const connected = new Set([...ws.servers].filter(([, wc]) => wc.status === 'connected').map(([name]) => name));
    for (const [name, registrations] of st.disposers) {
      if (connected.has(name)) continue;
      disposeRegistrations(registrations);
      st.disposers.delete(name);
    }
    for (const [name, wc] of ws.servers) {
      if (wc.status !== 'connected') continue;
      try {
        let registrations = st.disposers.get(name);
        if (!registrations) st.disposers.set(name, registrations = new Map());
        registerWorkspaceTools(agent, wsPath, wc.server, wc, registrations);
      } catch (error) {
        ctx.logger.warn(`mcp-manager: registering workspace server "${name}" tools failed: ${error?.message ?? error}`);
      }
    }
    reconcileRestrictForAgent(agent, ws, st);
  }

  function releaseWorkspace(wsPath, agent) {
    const st = agentScopeState.get(agent);
    if (st) { disposeAgentScope(st); agentScopeState.delete(agent); }
    const ws = workspaces.get(wsPath);
    if (!ws) return;
    ws.agents.delete(agent);
    if (ws.agents.size === 0) {
      for (const wc of ws.servers.values()) track(closeWorkspaceServer(wc));
      ws.servers.clear();
      closeWorkspaceWatchers(ws);
      if (ws.watchTimer) clearTimeout(ws.watchTimer);
      ws.watchTimer = null;
      workspaces.delete(wsPath);
      workspaceRescans.delete(wsPath);
    }
  }

  function ensureWorkspace(wsPath, rawPath) {
    let ws = workspaces.get(wsPath);
    if (ws) return ws;
    ws = { path: wsPath, rawPath, servers: new Map(), agents: new Set(), exclude: [], watchStop: null, watchTimer: null, error: '' };
    workspaces.set(wsPath, ws);
    return ws;
  }

  function rescanWorkspace(wsPath) {
    const prev = workspaceRescans.get(wsPath) ?? Promise.resolve();
    const next = prev.then(() => doRescan(wsPath), () => doRescan(wsPath));
    workspaceRescans.set(wsPath, next.then(() => {}, () => {}));
    return next;
  }

  function closeWorkspaceWatchers(ws) {
    if (!ws.watchStop) return;
    try { ws.watchStop(); } catch {}
    ws.watchStop = null;
  }

  function ensureWorkspaceWatchers(wsPath, ws) {
    if (ws.watchStop) return;
    const root = ws.rawPath ?? ws.path;
    const configPath = wsConfigPath(root);
    const onChange = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs && current.size === previous.size) return;
      if (ws.watchTimer) clearTimeout(ws.watchTimer);
      ws.watchTimer = setTimeout(() => {
        ws.watchTimer = null;
        void rescanWorkspace(wsPath).catch((error) => {
          ctx.logger.warn(`mcp-manager: workspace rescan failed for ${root}: ${error?.message ?? error}`);
        });
      }, 300);
    };
    try {
      watchFile(configPath, { interval: 250 }, onChange);
      ws.watchStop = () => unwatchFile(configPath, onChange);
    } catch (error) {
      ctx.logger.warn(`mcp-manager: cannot watch workspace config ${configPath}: ${error?.message ?? error}`);
    }
  }

  async function doRescan(wsPath) {
    const ws = workspaces.get(wsPath);
    if (!ws || disposed) return;
    ensureWorkspaceWatchers(wsPath, ws);
    const cfg = readWorkspaceConfig(ws.rawPath ?? ws.path);
    if (cfg.error) {
      ws.error = cfg.error;
      for (const wc of ws.servers.values()) { await closeWorkspaceServer(wc); wc.tools = []; wc.toolCount = 0; wc.status = 'pending-approval'; }
      for (const agent of ws.agents) rebuildAgentWorkspace(agent, wsPath);
      return;
    }
    for (const srv of cfg.servers) {
      srv.id = workspaceServerId(wsPath, srv.name);
      srv.wsPath = wsPath;
      const key = workspaceTokenKey(wsPath, srv.name);
      const saved = state.workspaceTokens[key];
      if (saved && srv.type === 'http' && saved.resource === binding(srv) && state.workspaceApprovals[key] === configFingerprint(srv)) srv.oauth = saved.oauth;
      else if (saved) { delete state.workspaceTokens[key]; saveState(); }
    }
    const errorChanged = ws.error !== '';
    ws.error = '';
    const excludeChanged = JSON.stringify([...(ws.exclude ?? [])].sort()) !== JSON.stringify([...(cfg.exclude ?? [])].sort());
    ws.exclude = cfg.exclude;
    let changed = excludeChanged || errorChanged;
    const desired = new Map();
    for (const srv of cfg.servers) {
      desired.set(srv.name, { conflict: serverNameTaken(srv.name, wsPath), server: srv });
    }
    let tokensDropped = false;
    for (const [name, wc] of ws.servers) {
      if (!desired.has(name)) {
        await closeWorkspaceServer(wc);
        ws.servers.delete(name);
        const key = workspaceTokenKey(wsPath, name);
        if (state.workspaceTokens[key] || state.workspaceApprovals[key]) { delete state.workspaceTokens[key]; delete state.workspaceApprovals[key]; tokensDropped = true; }
        changed = true;
      }
    }
    if (tokensDropped) saveState(state);
    for (const [name, entry] of desired) {
      const existing = ws.servers.get(name);
      if (entry.conflict) {
        if (!existing || existing.status !== 'conflict') {
          if (existing) await closeWorkspaceServer(existing);
          ws.servers.set(name, {
            server: entry.server, handle: null, status: 'conflict',
            error: `server name "${name}" is already used by another source`,
            toolCount: 0, tools: [], call: () => Promise.reject(new Error('conflict')),
          });
          changed = true;
        }
        continue;
      }
      if (existing && !['conflict', 'pending-approval', 'error'].includes(existing.status) && sameServerConfig(existing.server, entry.server)) continue;
      if (existing) await closeWorkspaceServer(existing);
      const wc = await openWorkspaceServer(entry.server);
      ws.servers.set(name, wc);
      changed = true;
    }
    if (changed) {
      for (const agent of ws.agents) rebuildAgentWorkspace(agent, wsPath);
      reconcileRestrictions();
    }
  }

  // Project one workspace server (live wsConn or on-disk config) into the view
  // shape the settings UI needs, including the transport fields for the editor.
  function workspaceServerView(server, status, toolCount, error) {
    const v = {
      id: server.id,
      name: server.name,
      type: server.type ?? 'http',
      authMode: server.authMode ?? '',
      source: 'workspace',
      enabled: server.enabled !== false,
      fingerprint: configFingerprint(server),
      status,
      toolCount,
      permissionReviewCount: permissionReviewCount(server),
      error,
    };
    if (v.type === 'stdio') {
      v.command = server.command;
      v.args = server.args ?? [];
      v.env = secretView(server.env);
      v.cwd = server.cwd ?? '';
    } else {
      v.url = server.url;
      v.headers = secretView(server.headers);
      v.headerEnv = server.headerEnv ?? {};
      if (v.authMode === 'static') v.tokenEnv = server.tokenEnv ?? '';
    }
    return v;
  }

  function workspaceView(ws) {
    return {
      path: ws.rawPath ?? ws.path,
      servers: [...ws.servers.values()].map((wc) => workspaceServerView(wc.server, wc.status, wc.toolCount, wc.error)),
      exclude: ws.exclude ?? [],
      error: ws.error ?? '',
    };
  }

  // Enumerate discovered workspaces for the settings UI: every registered
  // workspace (web) plus every directory an agent has actually opened.
  function listWorkspaces() {
    const discovered = [];
    const seen = new Set([...workspaces.values()].map((w) => w.rawPath ?? w.path));
    const registry = ctx.get('workspaceRegistry');
    if (registry && typeof registry.list === 'function') {
      for (const ws of registry.list()) {
        const path = ws?.path;
        if (typeof path === 'string' && path.length > 0) seen.add(path);
      }
    }
    for (const path of seen) {
      const canonical = canonicalize(path);
      const existing = workspaces.get(canonical);
      if (existing) {
        discovered.push(workspaceView(existing));
      } else {
        // Not yet loaded: reflect the on-disk config without connecting.
        const cfg = readWorkspaceConfig(path);
        discovered.push({
          path,
          servers: cfg.servers.map((s) => workspaceServerView(s, state.workspaceApprovals[workspaceTokenKey(canonical, s.name)] === configFingerprint(s) ? 'configured' : 'pending-approval', 0, '')),
          exclude: cfg.exclude,
          error: cfg.error,
        });
      }
    }
    return discovered;
  }

  function serverView(server) {
    const conn = live.get(server.id);
    const type = server.type ?? 'http';
    const enabled = server.enabled !== false;
    const view = {
      id: server.id,
      name: server.name,
      type,
      enabled,
      status: !enabled
        ? 'disabled'
        : (conn?.status ?? ((type !== 'stdio' && server.authMode === 'oauth' && !server.oauth?.tokens) ? 'needs-auth' : 'disconnected')),
      toolCount: conn?.toolCount ?? 0,
      permissionReviewCount: permissionReviewCount(server),
      error: conn?.error ?? '',
    };
    if (type === 'stdio') {
      view.command = server.command;
      view.args = server.args ?? [];
      view.env = secretView(server.env);
      view.cwd = server.cwd ?? '';
    } else {
      view.url = server.url;
      view.authMode = server.authMode;
      view.headers = secretView(server.headers);
      view.headerEnv = server.headerEnv ?? {};
      if (server.authMode === 'static') view.tokenEnv = server.tokenEnv ?? '';
    }
    return view;
  }

  // ---------- agent-creation decoration (per-agent workspace scoping) ----------

  // Cordis exposes the raw provider target behind its traceable proxy via this
  // process-global symbol (Symbol.for), so we can install a reversible method
  // wrapper without importing @deepseek-ai/cordis.
  const ORIGINAL = Symbol.for('cordis.original');

  function getPropertyDescriptor(target, prop) {
    let proto = target;
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc) return desc;
      proto = Object.getPrototypeOf(proto);
    }
    return undefined;
  }

  function installMethodWrapper(value, method, wrap) {
    const target = value?.[ORIGINAL] ?? value;
    const before = getPropertyDescriptor(target, method);
    if (!before || typeof before.value !== 'function') {
      throw new TypeError(`mcp-manager: cannot wrap non-function method ${String(method)}`);
    }
    const original = before.value;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, method);
    const installed = function (...args) { return wrap(original, this, args); };
    Object.defineProperty(target, method, {
      value: installed,
      writable: true,
      configurable: true,
      enumerable: before.enumerable ?? false,
    });
    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        if (target[method] !== installed) return;
        if (hadOwn) Object.defineProperty(target, method, before);
        else delete target[method];
      },
    };
  }

  // Establish workspace restrictions before any caller setup. Fail closed if scoping fails.
  function composeAgentSetup(callerSetup) {
    return async (agentCtx, currentAgent) => {
      const agent = currentAgent ?? agentCtx.agent;
      let wsPath = null;
      const cwd = agent?.session?.header?.cwd;
      if (typeof cwd === 'string' && cwd.length > 0 && isAbsolute(cwd)) {
        try {
          wsPath = canonicalize(cwd);
          const ws = ensureWorkspace(wsPath, cwd);
          ws.agents.add(agent);
          agentScopeState.set(agent, { wsPath, disposers: new Map(), restrictDisposer: undefined, restrictKey: undefined });
          await rescanWorkspace(wsPath);
          rebuildAgentWorkspace(agent, wsPath);
        } catch (error) {
          if (wsPath) releaseWorkspace(wsPath, agent);
          ctx.logger.warn(`mcp-manager: workspace scoping failed for ${cwd}: ${error?.message ?? error}`);
          throw new Error('Workspace MCP scope could not be established', { cause: error });
        }
      }
      if (wsPath) {
        agentCtx.effect(() => () => { releaseWorkspace(wsPath, agent); }, 'mcp-workspace-release');
      }
      return (await callerSetup?.(agentCtx, agent)) ?? undefined;
    };
  }

  function installAgentDecorators(agents) {
    const wrapCreate = (original, thisArg, args) => {
      const options = args[0];
      if (!options || typeof options !== 'object') throw new TypeError('mcp-manager: agents.create() requires options');
      return original.call(thisArg, { ...options, setup: composeAgentSetup(options.setup) });
    };
    const wrapResume = (original, thisArg, args) => {
      const options = args[0];
      if (!options || typeof options !== 'object') throw new TypeError('mcp-manager: agents.resume() requires options');
      return original.call(thisArg, { ...options, setup: composeAgentSetup(options.setup) });
    };
    const h1 = installMethodWrapper(agents, 'create', wrapCreate);
    const h2 = installMethodWrapper(agents, 'resume', wrapResume);
    return () => { h2.dispose(); h1.dispose(); };
  }

  // ---------- HTTP API on the GUI webserver ----------
  function json(res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  async function readBody(req) {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > config.maxBodyBytes) throw new Error('Request body exceeds limit');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be a JSON object');
    return body;
  }

  // Tokenize a command-line args string (respecting double/single quotes) into an argv array.
  function parseArgs(args) {
    if (args === undefined || args === null) return [];
    if (!Array.isArray(args) || args.length > 256 || args.some(value => typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > 16384)) throw new Error('args must be a bounded array of strings');
    return args;
  }

  // Normalize an env payload (object or JSON string) into a flat string->string map.
  function parseEnv(env, previous = {}) {
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const out = {};
      if (Object.keys(env).length > 100) throw new Error('Too many environment variables or headers');
      for (const k of Object.keys(env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Invalid environment variable or header name');
        const value = env[k];
        if (typeof value !== 'string' || value.length > 16384 || /[\r\n]/.test(value)) throw new Error('Invalid environment variable or header value');
        if (value === KEEP_SECRET) {
          if (!Object.hasOwn(previous, k)) throw new Error('No existing secret for this key');
          out[k] = previous[k];
        } else out[k] = value;
      }
      return out;
    }
    if (env === undefined || env === null) return {};
    throw new Error('Environment variables and headers must be objects of strings');
  }

  const route = ctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-manager',
    async handler(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const isCallback = /^\/mcp-manager\/callback\/[A-Za-z0-9_-]+$/.test(path) && req.method === 'GET';
      // OAuth navigations legitimately originate at an external provider. They
      // still require the authenticated browser cookie, trusted Host and state.
      const rejection = ctx.connection.requestRejection(isCallback ? { headers: { host: req.headers.host, cookie: req.headers.cookie } } : req);
      // Harness uses SameSite=Strict cookies. The provider's cross-site callback
      // cannot carry that cookie. A bounded pending state permits only a static
      // landing page; the same-origin Continue navigation performs the exchange
      // behind the normal authentication check on the next request.
      if (isCallback && rejection === 401) {
        const id = path.slice(CALLBACK_PATH.length + 1), found = findServerById(id), flow = pending.get(id);
        const callbackOrigin = requestOrigin(req);
        if (found && flow && flow.state === url.searchParams.get('state') && flow.origin === callbackOrigin && flow.resource === binding(found.server) && flow.expires >= Date.now()) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
          res.end(`<!doctype html><meta charset="utf-8"><title>Continue MCP authorization</title><h1>Return to Harness</h1><p>Continue to finish authorization using your signed-in Harness session.</p><a rel="noreferrer" href="${escapeHtml(path + url.search)}">Continue authorization</a>`);
          return;
        }
      }
      if (rejection !== undefined) return json(res, rejection, { error: rejection === 401 ? 'Authentication required' : 'Request origin is not trusted' });
      if (disposed) return json(res, 503, { error: 'Manager is shutting down' });
      if (['POST', 'PUT', 'DELETE'].includes(req.method) && (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'Content-Type must be application/json' });
      // HTTPS is enabled only for an explicitly configured and trusted Host.
      // Forwarded headers cannot choose the redirect or callback origin.
      const origin = requestOrigin(req);
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Request origin is not trusted' });
      try {
        // OAuth redirect: /mcp-manager/callback/:id
        const cbMatch = path.match(/^\/mcp-manager\/callback\/([A-Za-z0-9_-]+)$/);
        if (cbMatch && req.method === 'GET') {
          const found = findServerById(cbMatch[1]);
          const server = found?.server;
          const code = url.searchParams.get('code');
          const flowState = url.searchParams.get('state');
          const oauthError = url.searchParams.get('error');
          const done = (ok, message) => {
            res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
            res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px"><h2>${ok ? '✅ Authorized' : '❌ Authorization failed'}</h2><p>${escapeHtml(message)}</p><p><a href="/">Back to DSH</a></p></body>`);
          };
          if (!server) return done(false, 'No MCP server config matches this callback');
          const flow = pending.get(server.id);
          if (!flow || flow.state !== flowState || flow.origin !== origin || flow.resource !== binding(server) || flow.expires < Date.now()) return done(false, 'Authorization expired or invalid');
          if (oauthError) { pending.delete(server.id); setServerAuthStatus(server, 'needs-auth', 'Authorization declined'); return done(false, 'Authorization was declined by the provider'); }
          if (!code) { setServerAuthStatus(server, 'needs-auth', 'session expired'); return done(false, 'Authorization session expired or invalid. Start again from Settings > MCP'); }
          try {
            await exchangeCode(server, code, origin);
            if (found.wsPath) {
              // Reconnect the workspace server in place and re-register its tools
              // into every live agent in that workspace.
              const ws = workspaces.get(found.wsPath);
              if (ws && found.wsConn) {
                await closeWorkspaceServer(found.wsConn);
                const fresh = await openWorkspaceServer(server);
                ws.servers.set(server.name, fresh);
                for (const agent of ws.agents) rebuildAgentWorkspace(agent, found.wsPath);
              }
              const wc = ws?.servers.get(server.name);
              return done(true, `Connected to ${server.name}${wc && wc.status === 'connected' ? `; ${wc.toolCount} tools registered` : ''}. You can close this page.`);
            }
            const conn = await connect(server);
            return done(true, `Connected to ${server.name}; ${conn.toolCount} tools registered. You can close this page.`);
          } catch (error) {
            setServerAuthStatus(server, 'error', publicError(error));
            return done(false, publicError(error));
          }
        }

        // JSON API: /mcp-manager/api/...
        if (!path.startsWith(API_PREFIX)) { res.writeHead(404); res.end(); return; }
        const rest = path.slice(API_PREFIX.length);
        const idMatch = rest.match(/^\/servers\/([A-Za-z0-9_-]+)(\/[a-z]+)?$/);
        const permissionsMatch = rest.match(/^\/permissions\/([A-Za-z0-9_-]+)$/);
        if (permissionsMatch && ['GET', 'PUT'].includes(req.method)) {
          const found = findServerById(permissionsMatch[1]);
          if (!found) return json(res, 404, { error: 'MCP server not found' });
          if (req.method === 'GET') return json(res, 200, permissionView(found.server));
          const body = await readBody(req);
          if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > config.maxTools) return json(res, 400, { error: 'Supply a bounded list of tool permission changes' });
          const tools = permissionTools(found.server), changes = [], seen = new Set();
          for (const change of body.changes) {
            if (!change || typeof change.name !== 'string' || seen.has(change.name) || !permissionModes.includes(change.mode)) return json(res, 400, { error: 'Invalid or duplicate tool permission' });
            seen.add(change.name);
            const tool = tools.find(t => t.name === change.name);
            if (!tool) return json(res, 409, { error: 'Tool list changed. Reload and review the current tools.' });
            const record = permissionRecord(found.server, tool);
            if (change.fingerprint !== record.fingerprint) return json(res, 409, { error: 'Tool definition changed. Reload and review it again.' });
            changes.push([record, change.mode]);
          }
          const previous = state.toolPermissions;
          state.toolPermissions = { ...previous };
          for (const [record, mode] of changes) {
            const key = createHash('sha256').update(`${found.server.id}\0${record.name}`).digest('hex');
            state.toolPermissions[key] = { ...record, mode, reviewRequired: false };
          }
          try { saveState(); } catch (error) { state.toolPermissions = previous; throw error; }
          return json(res, 200, permissionView(found.server));
        }

        if (req.method === 'GET' && rest === '/ping') {
          return json(res, 200, { ok: true, version: 4, stdio: true, workspace: true, onDemandTools: true });
        }
        if (req.method === 'GET' && rest === '/settings') {
          return json(res, 200, { onDemandToolInjection: state.onDemandToolInjection });
        }
        if (req.method === 'POST' && rest === '/settings/on-demand') {
          const body = await readBody(req);
          if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be a boolean' });
          setOnDemandToolInjection(body.enabled);
          return json(res, 200, { onDemandToolInjection: state.onDemandToolInjection });
        }
        if (req.method === 'GET' && rest === '/workspaces') {
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'POST' && rest === '/workspaces/approve') {
          const body = await readBody(req);
          const path = knownWorkspacePath(String(body.path ?? ''));
          if (!path) return json(res, 403, { error: 'Unknown workspace' });
          approveWorkspaceEntry(path, String(body.name ?? ''), String(body.fingerprint ?? ''));
          if (workspaces.has(path)) await rescanWorkspace(path);
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'POST' && rest === '/workspaces/auth') {
          const body = await readBody(req);
          const path = String(body.path ?? '').trim();
          const name = String(body.name ?? '').trim();
          if (!path || !name) return json(res, 400, { error: 'path and name are required' });
          const canonical = knownWorkspacePath(path);
          if (!canonical) return json(res, 403, { error: 'path is not a registered or active DSH workspace' });
          const ws = workspaces.get(canonical);
          const wc = ws?.servers.get(name);
          if (!wc) return json(res, 404, { error: `workspace server "${name}" not found in ${path}` });
          if ((wc.server.type ?? 'http') !== 'http' || wc.server.authMode !== 'oauth') return json(res, 400, { error: 'only HTTP OAuth workspace servers need authorization' });
          const authorizeUrl = await startAuth(wc.server, origin);
          return json(res, 200, { authorizeUrl });
        }
        if (req.method === 'POST' && rest === '/workspaces/exclude') {
          const body = await readBody(req);
          const path = String(body.path ?? '').trim();
          const server = String(body.server ?? '').trim();
          const exclude = body.exclude === true;
          if (!path) return json(res, 400, { error: 'path is required' });
          if (!state.servers.some((s) => s.name === server)) return json(res, 400, { error: `unknown global server "${server}"` });
          const canonical = knownWorkspacePath(path);
          if (!canonical) return json(res, 403, { error: 'path is not a registered or active DSH workspace' });
          const raw = readWorkspaceRaw(canonical);
          let list = (Array.isArray(raw.exclude) ? raw.exclude : []).filter((x) => typeof x === 'string' && x !== server);
          if (exclude) list.push(server);
          raw.exclude = [...new Set(list)];
          writeWorkspaceRaw(canonical, raw);
          const ws = workspaces.get(canonical);
          if (ws) await rescanWorkspace(canonical);
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'POST' && rest === '/workspaces/servers') {
          const body = await readBody(req);
          const path = String(body.path ?? '').trim();
          if (!path) return json(res, 400, { error: 'path is required' });
          const canonical = knownWorkspacePath(path);
          if (!canonical) return json(res, 403, { error: 'path is not a registered or active DSH workspace' });
          const raw = readWorkspaceRaw(canonical);
          const { name, entry, error } = buildWorkspaceEntry(body, raw.mcpServers?.[body.oldName] ?? {});
          if (error) return json(res, 400, { error });
          if (raw.mcpServers && typeof raw.mcpServers === 'object' && name in raw.mcpServers) {
            return json(res, 409, { error: `a server named ${name} already exists in this workspace` });
          }
          if (serverNameTaken(name, canonical)) return json(res, 409, { error: `a server named ${name} already exists (global or in another workspace)` });
          raw.mcpServers = raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers) ? raw.mcpServers : {};
          raw.mcpServers[name] = entry;
          writeWorkspaceRaw(canonical, raw);
          const approved = normalizeWorkspaceServer(name, entry, canonical);
          approveWorkspaceEntry(canonical, name, configFingerprint(approved));
          const ws = workspaces.get(canonical);
          if (ws) await rescanWorkspace(canonical);
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'PUT' && rest === '/workspaces/servers') {
          const body = await readBody(req);
          const path = String(body.path ?? '').trim();
          const oldName = String(body.oldName ?? '').trim();
          if (!path || !oldName) return json(res, 400, { error: 'path and oldName are required' });
          const canonical = knownWorkspacePath(path);
          if (!canonical) return json(res, 403, { error: 'path is not a registered or active DSH workspace' });
          const raw = readWorkspaceRaw(canonical);
          const { name, entry, error } = buildWorkspaceEntry(body, raw.mcpServers?.[body.oldName] ?? {});
          if (error) return json(res, 400, { error });
          if (!raw.mcpServers || typeof raw.mcpServers !== 'object' || !(oldName in raw.mcpServers)) {
            return json(res, 404, { error: `workspace server "${oldName}" not found` });
          }
          let keepOAuth = false;
          if (name === oldName && entry.type === 'http' && entry.authMode === 'oauth') {
            const previous = normalizeWorkspaceServer(oldName, raw.mcpServers[oldName], canonical);
            if (previous?.type === 'http' && previous.authMode === 'oauth') {
              try { keepOAuth = binding(previous) === binding({ url: entry.url }); } catch {}
            }
          }
          if (name !== oldName) {
            if (name in raw.mcpServers) return json(res, 409, { error: `a server named ${name} already exists in this workspace` });
            if (serverNameTaken(name, canonical)) return json(res, 409, { error: `a server named ${name} already exists (global or in another workspace)` });
          }
          delete raw.mcpServers[oldName];
          raw.mcpServers[name] = entry;
          writeWorkspaceRaw(canonical, raw);
          const approved = normalizeWorkspaceServer(name, entry, canonical);
          approveWorkspaceEntry(canonical, name, configFingerprint(approved));
          // Preserve OAuth state only while the same named server stays on the
          // same issuer; otherwise an old token/client registration is unsafe.
          const oldKey = workspaceTokenKey(canonical, oldName);
          if (!keepOAuth && state.workspaceTokens[oldKey]) {
            delete state.workspaceTokens[oldKey];
            saveState(state);
          }
          const ws = workspaces.get(canonical);
          if (ws) await rescanWorkspace(canonical);
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'POST' && rest === '/workspaces/servers/delete') {
          const body = await readBody(req);
          const path = String(body.path ?? '').trim();
          const name = String(body.name ?? '').trim();
          if (!path || !name) return json(res, 400, { error: 'path and name are required' });
          const canonical = knownWorkspacePath(path);
          if (!canonical) return json(res, 403, { error: 'path is not a registered or active DSH workspace' });
          const raw = readWorkspaceRaw(canonical);
          if (raw.mcpServers && typeof raw.mcpServers === 'object') delete raw.mcpServers[name];
          writeWorkspaceRaw(canonical, raw);
          const key = workspaceTokenKey(canonical, name);
          delete state.workspaceApprovals[key];
          delete state.workspaceTokens[key]; saveState();
          const ws = workspaces.get(canonical);
          if (ws) await rescanWorkspace(canonical);
          return json(res, 200, { workspaces: listWorkspaces() });
        }
        if (req.method === 'GET' && rest === '/servers') {
          return json(res, 200, { servers: state.servers.map(serverView) });
        }
        if (req.method === 'POST' && rest === '/servers') {
          const body = await readBody(req);
          const name = String(body.name ?? '').trim();
          const type = body.type === 'stdio' ? 'stdio' : 'http';
          if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return json(res, 400, { error: 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)' });
          if (serverNameTaken(name)) return json(res, 409, { error: `a server named ${name} already exists (global or in a workspace)` });

          let server;
          if (type === 'stdio') {
            const command = String(body.command ?? '').trim();
            if (!command) return json(res, 400, { error: 'stdio server requires a command (executable, e.g. npx / uvx / python)' });
            server = {
              id: b64url(randomBytes(8)),
              name, type: 'stdio', command,
              args: parseArgs(body.args),
              env: parseEnv(body.env),
            };
            const cwd = String(body.cwd ?? '').trim();
            if (cwd) server.cwd = cwd;
          } else {
            const serverUrl = canonicalUrl(String(body.url ?? '').trim());
            const authMode = body.authMode === 'static' ? 'static' : 'oauth';
            if (!/^https?:\/\//.test(serverUrl)) return json(res, 400, { error: 'url must be an http(s) URL' });
            server = {
              id: b64url(randomBytes(8)),
              name, type: 'http', url: serverUrl, authMode,
              headers: parseEnv(body.headers),
              headerEnv: parseEnv(body.headerEnv),
              ...(authMode === 'static' ? { tokenEnv: String(body.tokenEnv ?? '').trim() } : {}),
            };
          }

          if (state.servers.length >= config.maxTools) return json(res, 400, { error: 'Too many MCP servers' });
          state.servers.push(server);
          saveState(state);
          if (type === 'stdio') track(connect(server));
          else if (hasToken(server)) track(connect(server));
          else setLive(server.id, { status: 'needs-auth', error: server.authMode === 'static' ? 'missing token (set the env var)' : '' });
          return json(res, 201, { server: serverView(server) });
        }
        if (idMatch) {
          const server = state.servers.find((s) => s.id === idMatch[1]);
          if (!server) return json(res, 404, { error: 'server not found' });
          const action = idMatch[2];
          if (req.method === 'POST' && action === '/auth') {
            const authorizeUrl = await startAuth(server, origin);
            return json(res, 200, { authorizeUrl });
          }
          if (req.method === 'POST' && action === '/connect') {
            const conn = await connect(server);
            return json(res, 200, { server: serverView(server) });
          }
          if (req.method === 'POST' && action === '/enabled') {
            const body = await readBody(req);
            if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be a boolean' });
            const enabled = body.enabled;
            if (enabled === (server.enabled !== false)) {
              return json(res, 200, { server: serverView(server) });
            }
            server.enabled = enabled;
            saveState(state);
            if (!enabled) {
              // Unregister every tool and tear down the transport; config and
              // OAuth tokens stay persisted for the next enable.
              await disconnect(server.id);
            } else if ((server.type ?? 'http') === 'stdio') {
              await connect(server);
            } else if (hasToken(server)) {
              await connect(server);
            } else {
              setLive(server.id, { status: 'needs-auth', error: server.authMode === 'static' ? 'missing token (set the env var)' : '' });
            }
            return json(res, 200, { server: serverView(server) });
          }
          if (req.method === 'PUT' && !action) {
            const body = await readBody(req);
            const type = body.type === 'stdio' ? 'stdio' : 'http';
            const previousType = server.type ?? 'http';
            const previousAuthMode = server.authMode;
            let previousIssuer = '';
            if (previousType === 'http' && previousAuthMode === 'oauth') {
              try { previousIssuer = binding(server); } catch {}
            }

            // 1. 校验(先不改动 server,全部通过后再写)
            const newName = String(body.name ?? server.name).trim();
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(newName)) return json(res, 400, { error: 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)' });
            if (newName !== server.name && serverNameTaken(newName)) return json(res, 409, { error: `a server named ${newName} already exists (global or in a workspace)` });

            let next;
            if (type === 'stdio') {
              const command = String(body.command ?? '').trim();
              if (!command) return json(res, 400, { error: 'stdio server requires a command (executable, e.g. npx / uvx / python)' });
              next = { command, args: parseArgs(body.args), env: parseEnv(body.env, server.env) };
              const cwd = String(body.cwd ?? '').trim();
              if (cwd) next.cwd = cwd;
            } else {
              const serverUrl = canonicalUrl(String(body.url ?? '').trim());
              if (!/^https?:\/\//.test(serverUrl)) return json(res, 400, { error: 'url must be an http(s) URL' });
              next = {
                url: serverUrl,
                authMode: body.authMode === 'static' ? 'static' : 'oauth',
                headers: parseEnv(body.headers, server.headers),
                headerEnv: parseEnv(body.headerEnv),
              };
              if (next.authMode === 'static') {
                // 留空表示保留原有环境变量名(编辑表单只回填变量名,不回填实际值)
                next.tokenEnv = String(body.tokenEnv ?? '').trim();
              }
            }

            // 2. 断开旧连接,再更新配置
            await disconnect(server.id);
            server.name = newName;
            server.type = type;
            if (type === 'stdio') {
              server.command = next.command;
              server.args = next.args;
              server.env = next.env;
              if (next.cwd) server.cwd = next.cwd; else delete server.cwd;
              delete server.url; delete server.authMode; delete server.tokenEnv; delete server.headers; delete server.headerEnv; delete server.oauth; delete server.staticToken;
            } else {
              server.url = next.url;
              server.authMode = next.authMode;
              server.headers = next.headers;
              server.headerEnv = next.headerEnv;
              if (next.authMode === 'static') {
                server.tokenEnv = next.tokenEnv;
                delete server.oauth;
                // Once an env var name is set (or kept), the legacy plaintext
                // token is obsolete — drop it.
                if (server.tokenEnv) delete server.staticToken;
              } else {
                delete server.tokenEnv;
                delete server.staticToken;
                let nextIssuer = '';
                try { nextIssuer = binding(server); } catch {}
                if (previousType !== 'http' || previousAuthMode !== 'oauth' || previousIssuer !== nextIssuer) {
                  delete server.oauth;
                }
              }
              delete server.command; delete server.args; delete server.env; delete server.cwd;
            }
            saveState(state);

            // 3. 按新配置重连
            if (type === 'stdio') await connect(server);
            else if (hasToken(server)) await connect(server);
            else setLive(server.id, { status: 'needs-auth', error: server.authMode === 'static' ? 'missing token (set the env var)' : '' });
            return json(res, 200, { server: serverView(server) });
          }
          if (req.method === 'DELETE' && !action) {
            await disconnect(server.id);
            state.servers = state.servers.filter((s) => s.id !== server.id);
            state.toolPermissions = Object.fromEntries(Object.entries(state.toolPermissions).filter(([, record]) => record.serverId !== server.id));
            saveState(state);
            return json(res, 200, { ok: true });
          }
        }
        res.writeHead(404); res.end();
      } catch (error) {
        ctx.logger.error('mcp-manager: API operation failed');
        json(res, 400, { error: publicError(error) });
      }
    },
  });
  ctx.effect(() => route);

  // Install and withdraw workspace setup with the required agent registry service.
  if (typeof ctx.agents.create !== 'function' || typeof ctx.agents.resume !== 'function') throw new Error('Compatible Harness agent registry is required');
  ctx.effect(() => installAgentDecorators(ctx.agents), 'mcp-agent-decorators');

  // On plugin unload/reload, kill every live global + workspace stdio child
  // process and stop every workspace config watcher.
  ctx.effect(() => async () => {
    disposed = true; lifecycle.abort(); pending.clear(); permissionGrants.clear();
    brokerRuntimeDispose?.(); brokerRuntimeDispose = null;
    for (const st of agentScopeState.values()) disposeAgentScope(st);
    await Promise.all([...live.keys()].map(id => disconnect(id)));
    for (const ws of workspaces.values()) {
      closeWorkspaceWatchers(ws); clearTimeout(ws.watchTimer);
      await Promise.all([...ws.servers.values()].map(closeWorkspaceServer));
    }
    await Promise.allSettled([...operations, ...workspaceRescans.values()]);
    workspaces.clear(); agentScopeState.clear(); workspaceRescans.clear(); globalToolsByServer.clear();
  }, 'mcp-manager-runtime');

  // A reload also restores scopes for agents that were already running.
  // Cordis waits for this boundary before reporting the plugin ACTIVE.
  const restored = Promise.all((ctx.agents.list?.() ?? []).map(agent => composeAgentSetup()(agent.ctx, agent)));

  // ---------- startup: auto-connect stdio servers and HTTP servers that have credentials ----------
  for (const server of state.servers) {
    if (server.enabled === false) continue; // disabled servers stay dormant until re-enabled
    if ((server.type ?? 'http') === 'stdio') track(connect(server));
    else if (hasToken(server)) track(connect(server));
    else setLive(server.id, { status: 'needs-auth', error: '' });
  }
  return restored.then(() => undefined);
}
