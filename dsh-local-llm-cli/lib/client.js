/** Browser settings contribution, loaded through Harness's module loader. */
window.__ModuleLoader__.load({
  id: 'dsh-local-llm-cli',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'localLlmCli'
    const ENTRY = 'dsh-local-llm-cli'
    const API = '/api/dsh-local-llm-cli'
    const en = {
      nav: 'Local CLI', providers: 'CLI providers', codex: 'Codex CLI', status: 'Status',
      version: 'Version', path: 'Executable path', pathHint: 'Leave empty to auto-detect.',
      using: 'Using', unknown: 'Unknown', checking: 'Checking…', notInstalled: 'Not installed',
      chatgpt: 'Logged in using ChatGPT', apiKey: 'Logged in using an API key', authenticated: 'Signed in', signedOut: 'Not signed in',
      signIn: 'Sign in', signOut: 'Logout', refresh: 'Refresh', cancelLogin: 'Cancel sign-in',
      logoutHint: 'Logout also signs out other clients sharing this Codex CLI login.',
      confirmLogout: 'Confirm logout', cancel: 'Cancel', deviceHint: 'Open the verification page and enter this code:',
      verification: 'Open verification page', loginFailed: 'Sign-in failed. Try again or run codex login in a terminal.',
      loginComplete: 'Sign-in completed.', loginCancelled: 'Sign-in cancelled.', loginPending: 'Waiting for browser sign-in…',
      defaultModel: 'Default model', cliDefault: 'Codex built-in default', effort: 'Reasoning effort', effortDefault: 'Model default',
      minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra',
      workspace: 'Workspace directory', workspaceHint: 'Leave empty for an isolated temporary directory. This is separate from the executable path.',
      additional: 'Additional model IDs', additionalHint: 'One model ID per line. Listed models are a catalog; availability depends on your account.',
      advanced: 'Advanced settings', timeout: 'Request timeout (seconds)', calls: 'Maximum tool calls per response',
      save: 'Save changes', saving: 'Saving…', saved: 'Settings saved.', conflict: 'Settings were not saved. Your draft is preserved. Reload settings to discard it and load the current configuration.', reload: 'Reload settings (discard draft)',
      readOnly: 'Settings are read-only or unavailable on this connection.', loadError: 'Could not load Codex CLI status.',
      limitation: 'Text only. Responses appear after completion. Harness executes validated tool requests. Temperature and stop sequences are unsupported; output-token caps are not enforced.',
      selectionHint: 'Select Codex CLI in the conversation model selector to use this provider.',
      modelError: 'Model discovery', authHint: 'Authentication uses the login stored by Codex CLI on the Harness host.',
    }
    const css = `
      .lc-root{display:grid;grid-template-columns:170px minmax(0,1fr);border:1px solid var(--dsw-alias-border-strong,#ddd);border-radius:12px;overflow:hidden;max-width:880px;color:var(--dsw-alias-label-primary,#222);background:var(--dsw-alias-bg-layer-1,#fff)}
      .lc-root *{box-sizing:border-box}.lc-grid>div,.lc-field{min-width:0}
      .lc-nav{padding:18px 10px;border-right:1px solid var(--dsw-alias-border-strong,#ddd);background:var(--dsw-alias-bg-layer-2,#f6f6f6)}
      .lc-nav small{display:block;padding:0 10px 12px;color:var(--dsw-alias-label-tertiary,#777)}
      .lc-provider{display:block;width:100%;padding:9px 12px;text-align:left;border:0;border-radius:8px;background:var(--dsw-alias-accent,#0866e6);color:white;font-weight:600}
      .lc-main{padding:26px;display:flex;flex-direction:column;gap:20px;min-width:0}.lc-main h2{font-size:17px;margin:0 0 2px}
      .lc-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:14px;align-items:start}.lc-label{font-size:13px;line-height:30px}.lc-value{font-size:13px;line-height:30px;overflow-wrap:anywhere}
      .lc-main input,.lc-main select,.lc-main textarea{box-sizing:border-box;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-strong,#ddd);border-radius:7px;color:inherit;background:var(--dsw-alias-bg-layer-2,#f8f8f8);font:inherit;font-size:13px}
      .lc-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#777);margin:5px 0 0;overflow-wrap:anywhere}
      .lc-path{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lc-actions{display:flex;gap:8px;flex-wrap:wrap}.lc-actions button{padding:7px 18px;border:1px solid var(--dsw-alias-border-strong,#ddd);border-radius:20px;background:var(--dsw-alias-bg-layer-2,#eee);color:inherit;cursor:pointer;font-size:13px}
      .lc-actions button:disabled{opacity:.5;cursor:default}.lc-actions .lc-primary{background:var(--dsw-alias-accent,#0866e6);color:white;border-color:transparent}
      .lc-field{display:flex;flex-direction:column;gap:7px;font-size:13px}.lc-status{display:inline-flex;align-items:center;gap:7px}.lc-dot{width:8px;height:8px;border-radius:100%;background:#999}.lc-dot[data-ok=true]{background:#33a66f}
      .lc-notice{padding:12px;border:1px solid var(--dsw-alias-border-strong,#ddd);border-radius:8px;font-size:12px;line-height:1.5}.lc-error{color:var(--dsw-alias-danger,#ce3838)}.lc-main details summary{cursor:pointer;font-size:13px}.lc-main details>div{margin-top:14px}.lc-code{font-size:20px;letter-spacing:2px;font-weight:600;display:block;margin-top:8px}.lc-main a{color:var(--dsw-alias-accent,#0866e6)}
      @media(max-width:620px){.lc-root{grid-template-columns:minmax(0,1fr)}.lc-nav{border-right:0;border-bottom:1px solid var(--dsw-alias-border-strong,#ddd)}.lc-nav small{display:none}.lc-main{padding:18px}.lc-grid{grid-template-columns:minmax(0,1fr);gap:4px}.lc-label{margin-top:8px}}
    `

    async function api(action, signal) {
      const response = await fetch(API, {
        method: action ? 'POST' : 'GET', credentials: 'same-origin', signal,
        ...(action ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) } : {}),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    function Panel({ form, t }) {
      const snapshot = React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
      const [draft, setDraft] = React.useState(null)
      const [revision, setRevision] = React.useState(undefined)
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [logoutConfirm, setLogoutConfirm] = React.useState(false)
      const mounted = React.useRef(false)
      const requests = React.useRef(new Set())
      React.useEffect(() => {
        mounted.current = true
        const controller = new AbortController()
        api(undefined, controller.signal).then(value => { if (mounted.current) setStatus(value) }, err => { if (!controller.signal.aborted) setError(err.message) })
        return () => { mounted.current = false; controller.abort(); for (const request of requests.current) request.abort() }
      }, [])
      React.useEffect(() => {
        if (draft === null && snapshot.value) { setDraft({ ...snapshot.value }); setRevision(snapshot.revision) }
      }, [snapshot.value, snapshot.revision, draft])
      React.useEffect(() => {
        if (status?.login?.state !== 'pending') return
        const controller = new AbortController()
        const timer = setInterval(() => {
          api(undefined, controller.signal).then(setStatus, err => { if (!controller.signal.aborted) setError(err.message) })
        }, 2500)
        return () => { clearInterval(timer); controller.abort() }
      }, [status?.login?.state])
      const values = draft ?? snapshot.value ?? {}
      const set = (field, value) => { setDraft(current => ({ ...current, [field]: value })); setNotice('') }
      const disabled = busy || !snapshot.writable || draft === null
      const action = async name => {
        const controller = new AbortController(); requests.current.add(controller)
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await api(name, controller.signal)
          const next = name === 'login' || name === 'cancel-login' ? await api(undefined, controller.signal) : value
          if (mounted.current) { setStatus(next); setLogoutConfirm(false) }
        } catch (err) { if (mounted.current && !controller.signal.aborted) setError(err.message) }
        finally { requests.current.delete(controller); if (mounted.current) setBusy(false) }
      }
      const save = async () => {
        setBusy(true); setError(''); setNotice('')
        try {
          const ops = Object.entries(values).map(([field, value]) => ({ op: 'set', path: [field], value }))
          if (!await form.mutate(ops, revision)) { setError(t('conflict')); return }
          setRevision(form.getSnapshot().revision); setDraft({ ...form.getSnapshot().value }); setNotice(t('saved'))
          setStatus(await api('refresh'))
        } catch (err) { if (mounted.current) setError(err.message) }
        finally { if (mounted.current) setBusy(false) }
      }
      const field = (key, control, hint) => h('label', { className: 'lc-field' }, t(key), control, hint && h('p', { className: 'lc-hint' }, t(hint)))
      const input = (fieldName, extra = {}) => h('input', { value: values[fieldName] ?? '', disabled, onChange: event => set(fieldName, event.target.value), ...extra })
      const models = new Map([['codex-default', t('cliDefault')], ...(status?.models ?? []).map(model => [model.id, model.name])])
      for (const id of [values.defaultModel, ...(values.modelIds ?? [])].filter(Boolean)) if (!models.has(id)) models.set(id, id)
      const selectedModel = status?.models?.find(model => values.defaultModel === 'codex-default' ? model.isDefault : model.id === values.defaultModel)
      const efforts = selectedModel?.efforts?.length ? [...selectedModel.efforts] : ['minimal', 'low', 'medium', 'high', 'xhigh']
      if (values.reasoningEffort && values.reasoningEffort !== 'default' && !efforts.includes(values.reasoningEffort)) efforts.push(values.reasoningEffort)
      const login = status?.login
      return h('div', { className: 'lc-root' },
        h('aside', { className: 'lc-nav' }, h('small', null, t('providers')), h('button', { className: 'lc-provider', type: 'button', 'aria-current': 'page' }, t('codex'))),
        h('section', { className: 'lc-main', 'aria-label': t('codex') },
          h('h2', null, t('codex')),
          h('div', { className: 'lc-grid' },
            h('span', { className: 'lc-label' }, t('status')),
            h('span', { className: 'lc-value lc-status' }, h('span', { className: 'lc-dot', 'data-ok': status?.authenticated === true }),
              !status ? t('checking') : !status.installed ? t('notInstalled') : !status.authenticated ? t('signedOut') : t(status.authMethod === 'chatgpt' ? 'chatgpt' : status.authMethod === 'api-key' ? 'apiKey' : 'authenticated')),
            h('span', { className: 'lc-label' }, t('version')), h('span', { className: 'lc-value' }, status?.version ?? t('unknown')),
            h('label', { className: 'lc-label', htmlFor: 'lc-executable' }, t('path')),
            h('div', null, input('executablePath', { id: 'lc-executable', placeholder: '/path/to/codex', spellCheck: false }), h('p', { className: 'lc-hint' }, t('pathHint')), status?.path && h('p', { className: 'lc-hint lc-path', title: status.path }, `${t('using')}: ${status.path}`)),
          ),
          h('div', { className: 'lc-actions' },
            h('button', { disabled: busy || !status?.installed || status?.authenticated || login?.state === 'pending', onClick: () => action('login') }, status?.authenticated ? t('authenticated') : t('signIn')),
            h('button', { disabled: busy || !status?.authenticated, onClick: () => setLogoutConfirm(true) }, t('signOut')),
            h('button', { disabled: busy, onClick: () => action('refresh') }, t('refresh')),
          ),
          logoutConfirm && h('div', { className: 'lc-notice' }, t('logoutHint'), h('div', { className: 'lc-actions' }, h('button', { disabled: busy, onClick: () => action('logout') }, t('confirmLogout')), h('button', { disabled: busy, onClick: () => setLogoutConfirm(false) }, t('cancel')))),
          login?.state === 'pending' && h('div', { className: 'lc-notice', role: 'status' }, t('loginPending'), login.url && h('p', null, h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer' }, t('verification'))), login.code && h('div', null, t('deviceHint'), h('code', { className: 'lc-code' }, login.code)), h('div', { className: 'lc-actions' }, h('button', { disabled: busy, onClick: () => action('cancel-login') }, t('cancelLogin')))),
          login && ['failed', 'complete', 'cancelled'].includes(login.state) && h('p', { className: 'lc-hint', role: 'status' }, t(login.state === 'complete' ? 'loginComplete' : login.state === 'failed' ? 'loginFailed' : 'loginCancelled')),
          field('defaultModel', h('select', { disabled, value: values.defaultModel ?? 'codex-default', onChange: event => set('defaultModel', event.target.value) }, [...models].map(([id, title]) => h('option', { key: id, value: id }, title)))),
          field('effort', h('select', { disabled, value: values.reasoningEffort ?? 'default', onChange: event => set('reasoningEffort', event.target.value) }, h('option', { value: 'default' }, t('effortDefault')), efforts.map(effort => h('option', { key: effort, value: effort }, en[effort] ? t(effort) : effort)))),
          field('workspace', input('workspacePath', { spellCheck: false }), 'workspaceHint'),
          h('details', null, h('summary', null, t('advanced')), h('div', { className: 'lc-field' },
            field('additional', h('textarea', { rows: 3, disabled, value: (values.modelIds ?? []).join('\n'), onChange: event => set('modelIds', event.target.value.split('\n').map(id => id.trim()).filter(Boolean)) }), 'additionalHint'),
            field('timeout', h('input', { type: 'number', min: 1, max: 3600, disabled, value: (values.timeoutMs ?? 300000) / 1000, onChange: event => set('timeoutMs', Number(event.target.value) * 1000) })),
            field('calls', h('input', { type: 'number', min: 1, max: 100, step: 1, disabled, value: values.maxToolCalls ?? 16, onChange: event => set('maxToolCalls', Number(event.target.value)) })),
          )),
          h('div', { className: 'lc-actions' },
            h('button', { className: 'lc-primary', disabled, onClick: save }, t(busy ? 'saving' : 'save')),
            h('button', { disabled: busy || !snapshot.value, onClick: () => { setDraft({ ...snapshot.value }); setRevision(snapshot.revision); setError(''); setNotice('') } }, t('reload'))),
          !snapshot.writable && h('p', { className: 'lc-hint' }, t('readOnly')),
          notice && h('p', { role: 'status', className: 'lc-hint' }, notice),
          (error || status?.error) && h('div', { role: 'alert', className: 'lc-notice lc-error' }, error || status.error),
          status?.catalogError && h('p', { className: 'lc-hint' }, `${t('modelError')}: ${status.catalogError}`),
          h('div', { className: 'lc-notice' }, t('selectionHint'), h('p', { className: 'lc-hint' }, t('authHint')), h('p', { className: 'lc-hint' }, t('limitation'))),
      ))
    }
    return {
      inject: ['slots', 'configForms', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en }))
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          const style = document.createElement('style'); style.dataset.plugin = ENTRY; style.textContent = css
          document.head.appendChild(style); return () => style.remove()
        })
        ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => {
          const form = ctx.configForms.get(ENTRY)
          return ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: ENTRY, order: 110, label: () => t('nav'), locale: NS }, () => h(Panel, { form, t })))
        }))
      },
    }
  },
})
