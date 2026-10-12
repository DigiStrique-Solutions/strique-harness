window.__ModuleLoader__.load({
  id: 'dsh-mcp-manager-secure',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const KEEP = '__DSH_KEEP_CONFIGURED_SECRET__';
    const STATUS = { connected: 'Connected', 'needs-auth': 'Authentication required', authorizing: 'Authorizing', connecting: 'Connecting', error: 'Connection error', disconnected: 'Disconnected', disabled: 'Disabled', conflict: 'Name conflict', configured: 'Configured', 'pending-approval': 'Approval required' };
    const css = `
.mm_section{width:100%;max-width:760px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
.mm_section h3,.mm_section h4,.mm_section p{margin:0}.mm_section h3{font-size:18px;line-height:26px}.mm_section h4{font-size:13px}
.mm_catalogHeading,.mm_rowHead{display:flex;align-items:center;gap:10px}.mm_catalogHeading>span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.mm_addActions,.mm_actions{margin-left:auto}.mm_actions{display:flex;gap:8px;flex-wrap:wrap;max-width:100%}
.mm_cards{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
.mm_row{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0}
.mm_name{font-size:14px;font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}.mm_url{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.mm_meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.mm_err{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.mm_badge{font-size:11px;line-height:16px;padding:3px 8px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.mm_badge.connected{color:var(--dsw-alias-state-success-primary)}.mm_badge.error,.mm_badge.conflict{color:var(--dsw-alias-state-error-primary)}
.mm_badge.pending-approval,.mm_badge.needs-auth,.mm_badge.connecting{color:var(--dsw-alias-state-business-primary)}
.mm_btn{font:inherit;font-size:12px;line-height:18px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.mm_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.mm_btn:disabled{opacity:.5;cursor:default}.mm_btn.primary{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent}
.mm_section button:focus-visible,.mm_section input:focus-visible,.mm_section select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mm_field,.mm_form label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mm_section input:not([type=checkbox]),.mm_section select{box-sizing:border-box;max-width:100%;min-width:0;width:100%;font:inherit;font-size:13px;line-height:20px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.mm_section input::placeholder{color:var(--dsw-alias-label-tertiary)}.mm_section select option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.mm_form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mm_form .wide{grid-column:1/-1}.mm_section fieldset{min-width:0;display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.mm_section fieldset.mm_form{display:grid}.mm_section legend{font-size:12px;padding:0 4px;color:var(--dsw-alias-label-secondary)}
.mm_kv{display:flex;gap:8px;align-items:center}.mm_kv input{flex:1}.mm_kv button{flex:none}.mm_section fieldset>.mm_btn{align-self:flex-start}
.mm_wsSelect{margin-top:6px}.mm_wsCheck{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}.mm_wsCheck input{accent-color:var(--dsw-alias-state-business-primary)}
.mm_switch{position:relative;width:36px;height:22px;border:0;border-radius:14px;background:var(--dsw-alias-border-l2);cursor:pointer;flex:none}.mm_switch[data-on=true]{background:var(--dsw-alias-state-business-primary)}.mm_switch>span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .12s}.mm_switch[data-on=true]>span{transform:translateX(14px)}.mm_switch:disabled{opacity:.5;cursor:default}
.mm_wsExclude,.mm_details{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:12px}
.mm_permissionRow{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:12px;align-items:start;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l2)}.mm_permissionRow details{margin-top:5px}.mm_permissionRow summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}.mm_permissionsToolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.mm_permissionsToolbar>*{flex:1;min-width:180px}.mm_permissionRow select{min-height:36px}
@media(max-width:480px){.mm_permissionRow{grid-template-columns:minmax(0,1fr)}.mm_permissionRow select{width:100%}}
@media(max-width:650px){.mm_cards,.mm_form{grid-template-columns:1fr}.mm_catalogHeading{flex-wrap:wrap}.mm_kv{flex-wrap:wrap}.mm_kv input{flex-basis:calc(50% - 8px)}}
`;

    async function api(path, method = 'GET', body, signal) {
      const response = await fetch('/mcp-manager/api' + path, { method, signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
      return value;
    }
    function ErrorMessage({ error }) { return error ? h('p', { className: 'mm_err', role: 'alert' }, error) : null; }
    function Field({ label, value, onChange, placeholder, type = 'text' }) {
      return h('label', { className: 'mm_field wide' }, label, h('input', { type, value, placeholder, autoComplete: 'off', spellCheck: false, onChange: e => onChange(e.target.value) }));
    }
    function Pairs({ label, values, onChange, secret }) {
      const rows = Object.entries(values);
      return h('fieldset', { className: 'wide' }, h('legend', null, label),
        rows.map(([key, value], index) => h('div', { className: 'mm_kv', key: index },
          h('input', { 'aria-label': `${label} key ${index + 1}`, value: key, onChange: e => onChange(Object.fromEntries(rows.map((row, i) => i === index ? [e.target.value, row[1] === KEEP ? '' : row[1]] : row))) }),
          h('input', { 'aria-label': `${label} value ${index + 1}`, type: secret ? 'password' : 'text', autoComplete: 'off', value: value === KEEP ? '' : value, placeholder: value === KEEP ? 'Configured; leave blank to keep' : 'Value', onChange: e => onChange(Object.fromEntries(rows.map((row, i) => i === index ? [row[0], e.target.value] : row))) }),
          h('button', { type: 'button', className: 'mm_btn', 'aria-label': `Remove ${label} row ${index + 1}`, onClick: () => onChange(Object.fromEntries(rows.filter((_, i) => i !== index))) }, 'Remove'))),
        h('button', { type: 'button', className: 'mm_btn', onClick: () => onChange({ ...values, '': '' }), disabled: Object.hasOwn(values, '') }, 'Add row'));
    }
    function ServerForm({ server, workspacePath, onDone, onCancel }) {
      const [form, setForm] = React.useState(() => ({ name: '', type: 'http', url: '', authMode: 'static', tokenEnv: '', headers: {}, headerEnv: {}, command: '', args: [], env: {}, cwd: '', ...server }));
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const set = key => value => setForm(current => ({ ...current, [key]: value }));
      const submit = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const body = { ...form, headers: Object.fromEntries(Object.entries(form.headers).filter(([k]) => k)), headerEnv: Object.fromEntries(Object.entries(form.headerEnv).filter(([k]) => k)), env: Object.fromEntries(Object.entries(form.env).filter(([k]) => k)) };
          if (workspacePath) await api('/workspaces/servers', server ? 'PUT' : 'POST', { ...body, path: workspacePath, oldName: server?.name });
          else await api('/servers' + (server ? '/' + server.id : ''), server ? 'PUT' : 'POST', body);
          onDone();
        } catch (e) { setError(e.message); } finally { setBusy(false); }
      };
      return h('form', { className: 'mm_row', onSubmit: submit },
        h('h3', null, server ? 'Edit MCP server' : 'Add MCP server'),
        h('p', { className: 'mm_meta' }, workspacePath ? `Workspace: ${workspacePath}. Saving approves this definition.` : 'Available throughout this Harness profile.'),
        h('fieldset', { disabled: busy, className: 'mm_form', style: { border: 0, padding: 0 } },
          h(Field, { label: 'Name', value: form.name, onChange: set('name'), placeholder: 'meta_ads' }),
          h('label', { className: 'wide' }, 'Transport', h('select', { 'aria-label': 'Transport', value: form.type, onChange: e => set('type')(e.target.value) }, h('option', { value: 'http' }, 'HTTP'), h('option', { value: 'stdio' }, 'Local command (stdio)'))),
          form.type === 'stdio' ? h(React.Fragment, null,
            h('p', { className: 'mm_meta wide' }, 'This command runs with your operating system account permissions. Approve only commands and packages you trust. Put credentials in environment values, not arguments.'),
            h(Field, { label: 'Executable', value: form.command, onChange: set('command'), placeholder: 'npx' }),
            h('fieldset', { className: 'wide' }, h('legend', null, 'Arguments (one value per row)'), form.args.map((value, index) => h('div', { className: 'mm_kv', key: index }, h('input', { 'aria-label': `Argument ${index + 1}`, value, onChange: e => set('args')(form.args.map((old, i) => i === index ? e.target.value : old)) }), h('button', { type: 'button', className: 'mm_btn', onClick: () => set('args')(form.args.filter((_, i) => i !== index)) }, 'Remove'))), h('button', { type: 'button', className: 'mm_btn', onClick: () => set('args')([...form.args, '']) }, 'Add argument')),
            h(Field, { label: 'Working directory', value: form.cwd, onChange: set('cwd') }),
            h(Pairs, { label: 'Environment', values: form.env, onChange: set('env'), secret: true })) : h(React.Fragment, null,
            h(Field, { label: 'MCP endpoint URL', value: form.url, onChange: set('url'), placeholder: 'https://example.com/mcp' }),
            h('label', { className: 'wide' }, 'Authentication', h('select', { 'aria-label': 'Authentication', value: form.authMode, onChange: e => set('authMode')(e.target.value) }, h('option', { value: 'static' }, 'No auth, custom headers, or environment token'), h('option', { value: 'oauth' }, 'OAuth'))),
            form.authMode === 'static' ? h(Field, { label: 'Bearer token environment variable (optional)', value: form.tokenEnv, onChange: set('tokenEnv'), placeholder: 'MCP_BEARER_TOKEN' }) : null,
            h(Pairs, { label: 'Secret headers', values: form.headers, onChange: set('headers'), secret: true }),
            h(Pairs, { label: 'Header to environment variable mapping', values: form.headerEnv, onChange: set('headerEnv') }))),
        h(ErrorMessage, { error }), h('div', { className: 'mm_actions' }, h('button', { className: 'mm_btn primary', type: 'submit', disabled: busy }, busy ? 'Saving...' : workspacePath ? 'Save and approve' : 'Save'), h('button', { className: 'mm_btn', type: 'button', onClick: onCancel, disabled: busy }, 'Cancel')));
    }
    function ToolPermissions({ server, onBack }) {
      const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [query, setQuery] = React.useState(''), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState('');
      const controller = React.useRef(null), heading = React.useRef(null);
      const load = React.useCallback(async () => {
        controller.current?.abort(); const request = new AbortController(); controller.current = request;
        try { const value = await api(`/permissions/${server.id}`, 'GET', undefined, request.signal); if (!request.signal.aborted) { setData(value); setError(''); } }
        catch (e) { if (!request.signal.aborted) setError(e.message); }
      }, [server.id]);
      React.useEffect(() => { load(); heading.current?.focus(); return () => controller.current?.abort(); }, [load]);
      const change = async (tools, mode) => {
        controller.current?.abort(); const request = new AbortController(); controller.current = request;
        setBusy(true); setError(''); setNotice('');
        try {
          const value = await api(`/permissions/${server.id}`, 'PUT', { changes: tools.map(tool => ({ name: tool.name, fingerprint: tool.fingerprint, mode })) }, request.signal);
          if (!request.signal.aborted) { setData(value); setNotice('Permissions saved.'); }
        } catch (e) { if (!request.signal.aborted) setError(e.message); }
        finally { if (!request.signal.aborted) setBusy(false); }
      };
      const tools = (data?.tools ?? []).filter(tool => `${tool.title} ${tool.name}`.toLowerCase().includes(query.toLowerCase()));
      const options = () => [h('option', { key: 'allow', value: 'allow' }, 'Always allow'), h('option', { key: 'ask', value: 'ask' }, 'Ask each time'), h('option', { key: 'block', value: 'block' }, 'Block')];
      return h('section', { className: 'mm_section', 'aria-label': 'Tool permissions' },
        h('button', { className: 'mm_btn', style: { alignSelf: 'flex-start' }, onClick: onBack, disabled: busy }, 'Back to servers'),
        h('h3', { ref: heading, tabIndex: -1 }, `${server.name} tool permissions`),
        h('p', { className: 'mm_meta' }, 'Choose which tools can run automatically, need your approval for each call, or are blocked. Description and title changes preserve permissions. Changes to tool schemas or server configuration require review.'),
        h(ErrorMessage, { error }), h('button', { className: 'mm_btn', style: { alignSelf: 'flex-start' }, disabled: busy, onClick: load }, 'Reload permissions'),
        h('p', { className: 'mm_meta', role: 'status', 'aria-live': 'polite' }, busy ? 'Saving permissions...' : notice),
        !data ? error ? null : h('p', { role: 'status' }, 'Loading tools...') : h(React.Fragment, null,
          h('div', { className: 'mm_permissionsToolbar' }, h(Field, { label: 'Search tools', value: query, onChange: setQuery }),
            h('label', { className: 'mm_field' }, 'Set all displayed tools', h('select', { value: '', disabled: busy || !!error || tools.length === 0, onChange: e => { if (e.target.value) change(tools, e.target.value); } }, h('option', { value: '' }, 'Choose permission'), options()))),
          h('p', { className: 'mm_meta' }, `${tools.length} of ${data.tools.length} tools. Bulk changes apply only to these displayed tools.`),
          h('div', { className: 'mm_row' }, tools.length === 0 ? h('p', { className: 'mm_meta' }, data.tools.length ? 'No matching tools.' : 'No tools available. Connect or enable this server, then reload permissions.') : tools.map(tool => h('div', { key: tool.name, className: 'mm_permissionRow' },
            h('div', null, h('div', { className: 'mm_name' }, tool.title), tool.title !== tool.name ? h('p', { className: 'mm_meta' }, tool.name) : null,
              tool.reviewRequired ? h('p', { className: 'mm_meta', role: 'status' }, `Permission review required: ${tool.reviewReason}`) : null,
              tool.description ? h('details', null, h('summary', null, 'Tool description'), h('p', { className: 'mm_meta' }, tool.description)) : null),
            h('select', { 'aria-label': `Permission for ${tool.name}`, value: tool.mode, disabled: busy || !!error, onChange: e => change([tool], e.target.value) }, options()))))));
    }
    function ServerRow({ server, workspacePath, onChanged, onEdit, onPermissions }) {
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [review, setReview] = React.useState(false);
      const act = async action => { setBusy(true); setError(''); try { await action(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
      const authenticate = () => {
        // Open synchronously to avoid popup blockers; sever the opener before navigation.
        const popup = window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        return act(async () => {
          try {
            const value = workspacePath ? await api('/workspaces/auth', 'POST', { path: workspacePath, name: server.name }) : await api(`/servers/${server.id}/auth`, 'POST');
            if (value.authorizeUrl) { if (!popup) throw new Error('Allow popups for Harness, then try authentication again.'); popup.location.replace(value.authorizeUrl); }
            else popup?.close();
          } catch (error) { popup?.close(); throw error; }
        });
      };
      const remove = () => { if (window.confirm(`Remove MCP server "${server.name}"?`)) act(() => workspacePath ? api('/workspaces/servers/delete', 'POST', { path: workspacePath, name: server.name }) : api(`/servers/${server.id}`, 'DELETE')); };
      return h('article', { className: 'mm_row' },
        h('div', { className: 'mm_rowHead' }, h('span', { className: 'mm_name' }, server.name), h('span', { className: `mm_badge ${server.status}` }, STATUS[server.status] || server.status)),
        h('div', { className: 'mm_url' }, server.type === 'stdio' ? `${server.command} ${JSON.stringify(server.args || [])}` : server.url),
        server.status === 'connected' ? h('div', { className: 'mm_meta' }, `${server.toolCount} tools`) : null,
        server.permissionReviewCount > 0 ? h('p', { className: 'mm_meta', role: 'status' }, `${server.permissionReviewCount} ${server.permissionReviewCount === 1 ? 'tool requires' : 'tools require'} permission review. Open Tool permissions to review the changes.`) : null,
        h(ErrorMessage, { error: error || server.error }),
        h('div', { className: 'mm_actions', style: { flexWrap: 'wrap' } },
          h('button', { className: 'mm_btn', onClick: onPermissions, disabled: busy || server.status === 'pending-approval' }, 'Tool permissions'),
          server.status === 'pending-approval' ? h('button', { className: 'mm_btn primary', onClick: () => setReview(!review), disabled: busy, 'aria-expanded': review }, 'Review configuration') : null,
          !workspacePath ? h('button', { className: 'mm_switch', role: 'switch', 'aria-label': `Enable ${server.name}`, 'aria-checked': server.enabled !== false, 'data-on': server.enabled !== false, disabled: busy, onClick: () => act(() => api(`/servers/${server.id}/enabled`, 'POST', { enabled: server.enabled === false })) }, h('span')) : null,
          !workspacePath && server.enabled !== false ? h('button', { className: 'mm_btn', disabled: busy, onClick: () => act(() => api(`/servers/${server.id}/connect`, 'POST')) }, 'Reconnect') : null,
          server.enabled !== false && server.authMode === 'oauth' && server.status !== 'pending-approval' ? h('button', { className: 'mm_btn', onClick: authenticate, disabled: busy }, 'Authenticate') : null,
          h('button', { className: 'mm_btn', onClick: onEdit, disabled: busy }, 'Edit'), h('button', { className: 'mm_btn', onClick: remove, disabled: busy }, 'Remove')),
        review ? h('div', { className: 'mm_details' },
          h('p', { className: 'mm_meta' }, server.type === 'stdio' ? 'Approving starts this command with your account permissions. Review the workspace file and its environment values before continuing.' : 'Approving connects to this endpoint and makes its tools available to agents in this workspace.'),
          h('div', { className: 'mm_url' }, `Working directory: ${server.cwd || '(default)'}; environment keys: ${Object.keys(server.env || {}).join(', ') || '(none)'}; header keys: ${Object.keys(server.headers || {}).join(', ') || '(none)'}`),
          h('div', { className: 'mm_url' }, `Environment references: ${JSON.stringify({ tokenEnv: server.tokenEnv || '', headerEnv: server.headerEnv || {} })}`),
          h('div', { className: 'mm_meta' }, `Definition fingerprint: ${server.fingerprint}`),
          h('button', { className: 'mm_btn primary', disabled: busy, onClick: () => act(async () => { await api('/workspaces/approve', 'POST', { path: workspacePath, name: server.name, fingerprint: server.fingerprint }); setReview(false); }) }, 'Approve this configuration')) : null);
    }
    function McpSection() {
      const [permissions, setPermissions] = React.useState(null);
      const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [selected, setSelected] = React.useState(''), [form, setForm] = React.useState(null), [query, setQuery] = React.useState(''), [busy, setBusy] = React.useState(false);
      const mounted = React.useRef(false), generation = React.useRef(0), pending = React.useRef(null);
      const refresh = React.useCallback(async () => {
        const current = ++generation.current; pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
        try {
          const [servers, workspaces, settings] = await Promise.all([api('/servers', 'GET', undefined, controller.signal), api('/workspaces', 'GET', undefined, controller.signal), api('/settings', 'GET', undefined, controller.signal)]);
          if (mounted.current && current === generation.current) { setData({ ...servers, ...workspaces, ...settings }); setError(''); }
        } catch (e) { if (mounted.current && !controller.signal.aborted) setError(e.message); }
      }, []);
      React.useEffect(() => { mounted.current = true; refresh(); const interval = setInterval(refresh, 3000); return () => { mounted.current = false; clearInterval(interval); pending.current?.abort(); }; }, [refresh]);
      const workspace = data?.workspaces.find(ws => ws.path === selected);
      if (permissions) return h(ToolPermissions, { server: permissions, onBack: () => { setPermissions(null); refresh(); } });
      if (form) return h('div', { className: 'mm_section' }, h(ServerForm, { server: form.server, workspacePath: form.path, onDone: () => { setForm(null); refresh(); }, onCancel: () => setForm(null) }));
      if (!data) return h('div', { className: 'mm_section' }, h(ErrorMessage, { error }), error ? h('button', { className: 'mm_btn', onClick: refresh }, 'Retry') : h('p', { role: 'status' }, 'Loading MCP servers...'));
      const act = async callback => { setBusy(true); try { await callback(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
      const servers = (selected ? workspace?.servers || [] : data.servers).filter(server => server.name.toLowerCase().includes(query.toLowerCase()));
      return h('section', { className: 'mm_section', 'aria-label': 'Secure MCP manager' },
        h('div', { className: 'mm_catalogHeading' }, h('h3', null, 'MCP servers'), h('span', null, servers.length), h('button', { className: 'mm_btn primary mm_addActions', disabled: !!error || !!selected && !workspace, onClick: () => setForm({ path: selected }) }, 'Add server')),
        h(ErrorMessage, { error }),
        h('label', { className: 'mm_meta' }, 'Scope', h('select', { 'aria-label': 'Scope', className: 'mm_wsSelect', value: selected, onChange: e => setSelected(e.target.value) }, h('option', { value: '' }, 'Global (this profile)'), data.workspaces.map(ws => h('option', { key: ws.path, value: ws.path }, ws.path)))),
        h('label', { className: 'mm_wsCheck' }, h('input', { type: 'checkbox', checked: data.onDemandToolInjection, disabled: busy, onChange: e => act(() => api('/settings/on-demand', 'POST', { enabled: e.target.checked })) }), 'Discover tools on demand'),
        h(Field, { label: 'Search servers', value: query, onChange: setQuery }),
        h(ErrorMessage, { error: workspace?.error }),
        h('div', { className: 'mm_cards' }, servers.map(server => h(ServerRow, { key: server.id, server, workspacePath: selected, onChanged: refresh, onEdit: () => setForm({ server, path: selected }), onPermissions: () => setPermissions(server) }))),
        servers.length === 0 ? h('p', { className: 'mm_meta' }, query ? 'No matching servers.' : 'No servers in this scope. Add a server to get started.') : null,
        selected && workspace ? h('div', { className: 'mm_wsExclude' }, h('h4', null, 'Global servers available in this workspace'), data.servers.map(server => h('label', { className: 'mm_wsCheck', key: server.id }, h('input', { type: 'checkbox', checked: !(workspace.exclude || []).includes(server.name), disabled: busy, onChange: e => act(() => api('/workspaces/exclude', 'POST', { path: selected, server: server.name, exclude: !e.target.checked })) }), server.name))) : null);
    }
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.pluginCss = 'dsh-mcp-manager-secure/section';
        style.textContent = css;
        document.head.appendChild(style); return () => style.remove();
      });
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'mcp-manager-secure', order: 50, label: 'MCP (Secure)' }, McpSection));
    }
    return { apply, inject: ['slots'] };
  },
});
