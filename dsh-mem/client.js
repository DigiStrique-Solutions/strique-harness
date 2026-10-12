/**
 * dsh-mem — Client half (Web UI panel).
 *
 * Registers:
 * - a sidebar panel icon (`sidebar.panellist`, id `dsh-mem`);
 * - the Memory page in the `main` keyed slot under the same key;
 * - the `dshMem` locale namespace (English).
 *
 * Data flows over the package's authenticated `/api/dsh-mem/memories` route,
 * served by the Host half. All styling uses theme tokens so light and dark
 * themes follow the host application.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-mem',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dshMem'
    const PANEL_ID = 'dsh-mem'
    const API_PATH = '/api/dsh-mem/memories'

    const KINDS = ['lesson', 'preference', 'fact', 'concept']

    const KIND_COLORS = {
      lesson: 'var(--dsw-alias-state-warn-primary)',
      preference: 'var(--dsw-alias-brand-primary)',
      fact: 'var(--dsw-alias-state-idle-primary)',
      concept: 'var(--dsw-alias-state-success-primary)',
    }

    /** English UI copy; other locales fall back to this dictionary. */
    const en = {
      panel: 'Memory',
      title: 'Memory',
      subtitle: 'What your agent remembers across sessions',
      refresh: 'Refresh',
      retry: 'Retry',
      filter_all: 'All',
      filter_lesson: 'Lessons',
      filter_preference: 'Preferences',
      filter_fact: 'Facts',
      filter_concept: 'Concepts',
      stats_learned: 'learned lessons',
      stats_observed: 'auto-captured mistakes',
      empty: 'No memories yet.',
      empty_hint: 'The agent saves lessons, preferences, facts, and concepts through its memory tool; failed tool calls are captured automatically as unlearned lessons.',
      load_failed: 'Could not load memories',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      confirm_delete: 'Delete?',
      title_label: 'Title',
      body_label: 'Body',
      status_observed: 'observed',
      status_learned: 'learned',
      origin_auto: 'auto-captured',
      origin_model: 'agent-saved',
      origin_user: 'you',
      hits_suffix: 'recalls',
      updated_just_now: 'just now',
      updated_minutes: 'min ago',
      updated_hours: 'h ago',
      updated_days: 'd ago',
      action_failed: 'Action failed',
    }

    /**
     * Relative time label for an epoch-milliseconds stamp.
     * @param t - timestamp.
     * @param t0 - translate function.
     * @returns the label.
     */
    function relativeTime(t, t0) {
      const delta = Math.max(0, Date.now() - t)
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 1) return t0('updated_just_now')
      if (minutes < 60) return `${minutes} ${t0('updated_minutes')}`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} ${t0('updated_hours')}`
      return `${Math.floor(hours / 24)} ${t0('updated_days')}`
    }

    /** Sidebar panel icon; the sidebar owns the button and selected state. */
    function MemoryIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M12 3.5a4.2 4.2 0 0 0-4.16 3.6A3.9 3.9 0 0 0 4.6 11a3.9 3.9 0 0 0 1.2 7.6h1.1' }),
      h('path', { d: 'M12 3.5a4.2 4.2 0 0 1 4.16 3.6A3.9 3.9 0 0 1 19.4 11a3.9 3.9 0 0 1-1.2 7.6h-1.1' }),
      h('path', { d: 'M9.4 18.6h5.2' }),
      h('circle', { cx: 12, cy: 11.2, r: 1.6 }),
      h('path', { d: 'M12 9.6V7.4' }),
      h('path', { d: 'M10.7 12l-1.9 1.1' }),
      h('path', { d: 'M13.3 12l1.9 1.1' }),
      )
    }

    /** Small pill shared by kind badges, status chips, and tags. */
    function Pill({ color, children, title }) {
      return h('span', {
        title,
        style: {
          display: 'inline-flex', alignItems: 'center',
          padding: '1px 8px', borderRadius: 999,
          fontSize: 11, lineHeight: '16px', fontWeight: 500,
          color, background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
          border: '1px solid color-mix(in srgb, ' + color + ' 30%, transparent)',
          whiteSpace: 'nowrap',
        },
      }, children)
    }

    /** One memory row with inline edit and two-step delete. */
    function MemoryRow({ memory, t, busy, onChanged }) {
      const [editing, setEditing] = React.useState(false)
      const [title, setTitle] = React.useState(memory.title)
      const [body, setBody] = React.useState(memory.body)
      const [confirming, setConfirming] = React.useState(false)
      const kindColor = KIND_COLORS[memory.kind] ?? 'var(--dsw-alias-label-secondary)'

      const save = async () => {
        const ok = await onChanged({ action: 'update', id: memory.id, title, body })
        if (ok) setEditing(false)
      }
      const remove = async () => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        const ok = await onChanged({ action: 'delete', id: memory.id })
        if (ok) setConfirming(false)
      }

      const buttonStyle = {
        padding: '3px 10px', borderRadius: 6, fontSize: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      }

      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 8, padding: '10px 12px',
          background: 'var(--dsw-alias-bg-layer-2)',
          display: 'flex', flexDirection: 'column', gap: 6,
          opacity: busy ? 0.6 : 1,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h(Pill, { color: kindColor }, memory.kind),
        memory.kind === 'lesson' && memory.status !== undefined
          ? h(Pill, {
              color: memory.status === 'learned'
                ? 'var(--dsw-alias-state-success-primary)'
                : 'var(--dsw-alias-state-warn-primary)',
            }, t(memory.status === 'learned' ? 'status_learned' : 'status_observed'))
          : null,
        editing
          ? h('input', {
              value: title,
              onChange: e => setTitle(e.target.value),
              'aria-label': t('title_label'),
              style: {
                flex: '1 1 160px', minWidth: 160,
                fontSize: 13, padding: '3px 8px', borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-base)',
                color: 'var(--dsw-alias-label-primary)',
              },
            })
          : h('span', {
              style: {
                flex: 1, fontSize: 13, fontWeight: 600,
                color: 'var(--dsw-alias-label-primary)',
                overflowWrap: 'anywhere',
              },
            }, memory.title),
      ),
      editing
        ? h('textarea', {
            value: body,
            onChange: e => setBody(e.target.value),
            rows: Math.min(8, Math.max(2, Math.ceil(body.length / 80))),
            'aria-label': t('body_label'),
            style: {
              fontSize: 12, padding: '6px 8px', borderRadius: 6, resize: 'vertical',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              fontFamily: 'inherit',
            },
          })
        : h('div', {
            style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
          }, memory.body),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h(Pill, { color: 'var(--dsw-alias-label-secondary)' },
          memory.origin !== undefined ? t(`origin_${memory.origin}`) : memory.origin ?? ''),
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          `${relativeTime(memory.updatedAt, t)}${memory.hits > 0 ? ` · ${memory.hits} ${t('hits_suffix')}` : ''}`),
        h('div', { style: { flex: 1 } }),
        editing
          ? h(React.Fragment, null,
              h('button', { style: buttonStyle, onClick: save, disabled: busy }, t('save')),
              h('button', { style: buttonStyle, onClick: () => { setEditing(false); setTitle(memory.title); setBody(memory.body) }, disabled: busy }, t('cancel')),
            )
          : h(React.Fragment, null,
              h('button', { style: buttonStyle, onClick: () => setEditing(true), disabled: busy }, t('edit')),
              h('button', {
                style: {
                  ...buttonStyle,
                  ...(confirming ? {
                    borderColor: 'var(--dsw-alias-state-error-primary)',
                    color: 'var(--dsw-alias-state-error-primary)',
                  } : {}),
                },
                onClick: remove,
                disabled: busy,
              }, confirming ? t('confirm_delete') : t('delete')),
            ),
      ),
      )
    }

    /**
     * The Memory page: stats, kind filters, and the memory list.
     * @param props - slot-injected props carrying the bound translator.
     * @returns the page element.
     */
    function MemoryPage({ t }) {
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [filter, setFilter] = React.useState('all')
      const [busyId, setBusyId] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const response = await fetch(API_PATH)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setData(await response.json())
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      /**
       * Apply one row mutation and refresh the snapshot.
       * @param body - the POST body for the API route.
       * @returns whether the mutation succeeded.
       */
      const onChanged = React.useCallback(async (body) => {
        setBusyId(body.id ?? '*')
        setActionError(null)
        try {
          const response = await fetch(API_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const value = await response.json()
          if (!response.ok || value.ok !== true) {
            setActionError(value.error ?? `HTTP ${response.status}`)
            return false
          }
          await load()
          return true
        } catch (cause) {
          setActionError(cause instanceof Error ? cause.message : String(cause))
          return false
        } finally {
          setBusyId(null)
        }
      }, [load])

      if (loading && data === null) {
        return h('div', { style: { padding: 24, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, '…')
      }
      if (error !== null && data === null) {
        return h('div', { style: pageStyle },
          h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, `${t('load_failed')}: ${error}`),
          h('button', { onClick: load, style: chipStyle(true) }, t('retry')),
        )
      }
      const memories = data?.memories ?? []
      const stats = data?.stats ?? { total: 0, learned: 0, observed: 0 }
      const visible = filter === 'all' ? memories : memories.filter(memory => memory.kind === filter)

      return h('div', { style: pageStyle },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' } },
          h('h1', { style: { margin: 0, fontSize: 18, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle')),
          h('div', { style: { flex: 1 } }),
          h('button', { onClick: load, style: chipStyle(false), disabled: loading }, t('refresh')),
        ),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            `${stats.total} · ${stats.learned} ${t('stats_learned')} · ${stats.observed} ${t('stats_observed')}`),
          h('div', { style: { flex: 1 } }),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            ['all', ...KINDS].map(kind => h('button', {
              key: kind,
              onClick: () => setFilter(kind),
              style: chipStyle(filter === kind),
            }, t(`filter_${kind}`))),
          ),
        ),
        actionError !== null
          ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, `${t('action_failed')}: ${actionError}`)
          : null,
        visible.length === 0
          ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, padding: '12px 0' } },
              memories.length === 0 ? t('empty') + ' ' + t('empty_hint') : t('empty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              visible.map(memory => h(MemoryRow, {
                key: memory.id, memory, t, busy: busyId === memory.id || loading, onChanged,
              }))),
      )
    }

    const pageStyle = {
      height: '100%', overflow: 'auto', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: '20px 24px', background: 'var(--dsw-alias-bg-base)',
    }

    /**
     * Chip-button style, active for the selected filter.
     * @param active - whether the chip is selected.
     * @returns the style object.
     */
    function chipStyle(active) {
      return {
        padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
        background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'transparent',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en }), 'dsh-mem: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 15,
          label: () => t('panel'),
          locale: NS,
        }, MemoryIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, MemoryPage))
      },
    }
  },
})
