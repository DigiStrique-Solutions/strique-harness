import { createElement as h, useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import type { SkillAccess, Selection } from '../access-service.js'
import type { AccessMode, AccessScope } from '../access-policy.js'
import type { projectContext } from '../context.js'

type Inventory = Awaited<ReturnType<SkillAccess['inventory']>> & { writable: boolean }
type Entry = Inventory['entries'][number]
type Choices = Awaited<ReturnType<SkillAccess['choices']>>
type ContextView = ReturnType<typeof projectContext>
export type Request = <T>(endpoint: string, payload?: Record<string, unknown>) => Promise<T>
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', borderBottom: '1px solid var(--border-subtle, #8884)' }
const muted: CSSProperties = { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 13 }
const control: CSSProperties = { background: 'var(--bg-primary, transparent)', color: 'inherit', border: '1px solid var(--border-subtle, #8885)', borderRadius: 8, padding: '7px 10px', fontSize: 13, maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }
const stack: CSSProperties = { display: 'grid', gap: 12, minWidth: 0 }
const boundary = 'These rules control this plugin’s catalogs, skill tool and explicit invocations. Other plugins can read the upstream registry directly. They do not revoke CLI credentials, MCP connections or ordinary file access. Already loaded instructions remain in the conversation.'
function button(text: string, onClick: () => void, disabled = false) { return h('button', { type: 'button', style: { ...control, cursor: disabled ? 'default' : 'pointer' }, onClick, disabled }, text) }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Unable to load this view' }
function badge(text: string) { return h('span', { style: { ...muted, padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border-subtle, #8884)' } }, text) }
function modeSelect(label: string, value: string, onChange: (mode: AccessMode) => void, disabled = false) {
  return h('select', { 'aria-label': label, style: control, value, disabled, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value as AccessMode) },
    h('option', { value: 'off' }, 'Off'), h('option', { value: 'manual' }, 'Manual'), h('option', { value: 'automatic' }, 'Automatic'))
}
function Modal({ title, close, children }: { title: string; close: () => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus() } }, [])
  return h('dialog', { ref, onKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }, onCancel: (event: React.SyntheticEvent<HTMLDialogElement>) => { event.preventDefault(); close() }, style: { ...control, width: 'min(820px, calc(100vw - 40px))', maxHeight: '85vh', overflow: 'auto', padding: 24, background: 'var(--dsw-alias-background-primary, var(--bg-primary, Canvas))', color: 'var(--dsw-alias-label-primary, CanvasText)' }, 'aria-label': title },
    h('div', { style: { ...row, paddingTop: 0 } }, h('h2', { style: { margin: 0, flex: 1 } }, title), button('Close', close)), h('div', { style: stack }, children))
}

/** Settings contribution uses one server snapshot for counts, source explanations and controls. */
export function SkillsExperience({ request, Imports }: { request: Request; Imports: ComponentType }): ReturnType<typeof h> {
  const [choices, setChoices] = useState<Choices | null>(null)
  const [selection, setSelection] = useState<Selection>({})
  const [kind, setKind] = useState('conversation')
  const [tab, setTab] = useState('skills')
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [source, setSource] = useState('all')
  const [selected, setSelected] = useState<Entry | null>(null)
  const [scope, setScope] = useState<'global' | 'workspace' | 'preset'>('global')
  const [migration, setMigration] = useState(false)
  const generation = useRef(0)
  const ready = !!selection.sessionId || !!selection.projectRoot && !!selection.preset
  useEffect(() => { let active = true; request<Choices>('choices').then(value => { if (active) setChoices(value) }).catch(error => { if (active) setError(errorText(error)) }); return () => { active = false } }, [request])
  const refresh = async () => {
    const id = ++generation.current
    if (!choices) { try { setChoices(await request<Choices>('choices')); setError(null) } catch (error) { setError(errorText(error)); return } }
    if (!ready) { setInventory(null); return }
    setBusy(true); setError(null)
    try { const value = await request<Inventory>('inventory', { ...selection }); if (generation.current === id) setInventory(value) }
    catch (error) { if (generation.current === id) setError(errorText(error)) }
    finally { if (generation.current === id) setBusy(false) }
  }
  useEffect(() => { setInventory(null); setSelected(null); void refresh(); return () => { generation.current++ } }, [JSON.stringify(selection)])
  const change = async (entry: Entry | null, sourceId: string, mode: AccessMode) => {
    if (!inventory) return
    const accessScope: AccessScope = scope === 'global' ? { kind: 'global' } : { kind: scope, value: scope === 'workspace' ? inventory.view.cwd : inventory.view.preset }
    const id = generation.current
    setBusy(true); setError(null)
    try { const next = await request<Inventory>('access', { ...selection, revision: inventory.policyRevision, rule: { source: sourceId, ...(entry ? { skill: entry.name } : {}), mode, scope: accessScope } }); if (generation.current === id) { setInventory(next); setSelected(null) } }
    catch (error) { if (generation.current === id) setError(errorText(error)) }
    finally { if (generation.current === id) setBusy(false) }
  }
  const entries = inventory?.entries.filter(entry => (source === 'all' || source === entry.sourceId) && (filter === 'all' || entry.access.mode === filter)
    && `${entry.name} ${entry.description} ${entry.source} ${entry.provider}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const pick = (label: string, value: string, options: { value: string; label: string }[], onChange: (value: string) => void) => h('label', { style: { display: 'grid', gap: 5, minWidth: 0, flex: 1 } }, h('span', { style: muted }, label), h('select', { style: { ...control, width: '100%' }, 'aria-label': label, value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value) }, h('option', { value: '' }, `Select ${label.toLowerCase()}`), ...options.map(option => h('option', { key: option.value, value: option.value }, option.label))))
  return h('section', { style: { ...stack, width: '100%', maxWidth: 960, padding: '8px 0 32px' }, 'aria-label': 'Skill inventory' },
    h('div', null, h('h2', { style: { margin: '0 0 8px' } }, 'Skills'), h('p', { style: muted }, 'See what DSH can use, where it came from and what is included in a conversation.')),
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, role: 'tablist', 'aria-label': 'Skill views' }, ...['skills', 'sources', 'imports'].map(value => h('button', { type: 'button', key: value, role: 'tab', 'aria-selected': tab === value, style: { ...control, fontWeight: tab === value ? 700 : 400 }, onClick: () => setTab(value) }, value === 'skills' ? 'All skills' : value === 'sources' ? 'Sources & access' : 'Imported copies'))),
    tab === 'imports' ? h(Imports) : h('div', { style: stack },
      h('div', { style: { ...stack, padding: 14, border: '1px solid var(--border-subtle, #8884)', borderRadius: 10 } },
        h('div', { style: { display: 'flex', gap: 8 } }, button('Conversation', () => { setKind('conversation'); setSelection({}) }, kind === 'conversation'), button('Workspace & preset', () => { setKind('workspace'); setSelection({}) }, kind === 'workspace')),
        kind === 'conversation' ? pick('Conversation', selection.sessionId ?? '', choices?.sessions.map(item => ({ value: item.id, label: `${item.id.slice(0, 26)} · ${item.cwd ?? 'Workspace unavailable'}` })) ?? [], value => setSelection({ sessionId: value || undefined }))
          : h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, pick('Workspace', selection.projectRoot ?? '', choices?.workspaces.map(value => ({ value, label: value })) ?? [], projectRoot => setSelection({ ...selection, projectRoot })), pick('Preset', selection.preset ?? '', choices?.presets.map(item => ({ value: item.id, label: item.id })) ?? [], preset => setSelection({ ...selection, preset }))),
        inventory && h('p', { style: { ...muted, overflowWrap: 'anywhere', margin: 0 } }, `${inventory.view.cwd} · ${inventory.view.preset}`)),
      error && h('div', { role: 'alert', style: { color: 'var(--fg-danger, #c33)' } }, error, inventory && ' Displayed data may be stale.', button('Retry', () => void refresh())),
      busy && h('p', { role: 'status', style: muted }, 'Loading skill access…'),
      !ready && h('p', { style: muted }, 'Select a conversation or workspace and preset to inspect the exact skills available there.'),
      inventory && h('div', { style: stack, 'aria-busy': busy },
        !inventory.complete && h('p', { role: 'alert' }, 'Discovery is incomplete or changed during this read. Refresh before changing access.'),
        !inventory.migrated && h('div', { style: { ...control, padding: 14 } }, h('strong', null, inventory.needsReview ? 'Saved access rules require review after this upgrade' : 'Shared-source access has not been reviewed'), h('span', { style: { ...muted, display: 'block', margin: '6px 0' } }, inventory.needsReview ? 'Skill loading is blocked until you review the changed source identities.' : 'Existing discovery is preserved until you review it.'), button('Review shared access', () => setMigration(true), busy || !inventory.complete)),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, badge(`${inventory.counts.candidates} definitions`), badge(`${inventory.counts.available} available`), badge(`${inventory.counts.automatic} automatic`), badge(`${inventory.counts.manual} manual`), button('Refresh', () => void refresh(), busy)),
        h('label', { style: muted }, 'Save rules for ', h('select', { style: control, 'aria-label': 'Access rule scope', value: scope, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setScope(event.target.value as typeof scope) }, h('option', { value: 'global' }, 'All DSH workspaces'), h('option', { value: 'workspace' }, 'This workspace'), h('option', { value: 'preset' }, 'This preset'))),
        h('details', { style: muted }, h('summary', null, 'How access rules work'), h('p', null, 'Controls show effective access in this view. Off at the source blocks all its skills. A global skill rule can override an admitted source default; workspace and preset restrictions still apply.')),
        tab === 'skills' ? h('div', null,
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, h('input', { style: { ...control, flex: 1, minWidth: 130 }, type: 'search', placeholder: 'Search skills', 'aria-label': 'Search skills', value: query, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value) }),
            h('select', { style: control, 'aria-label': 'Filter access', value: filter, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setFilter(event.target.value) }, ...['all', 'off', 'manual', 'automatic'].map(value => h('option', { key: value, value }, value === 'all' ? 'All access' : value))),
            h('select', { style: control, 'aria-label': 'Filter source', value: source, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSource(event.target.value) }, h('option', { value: 'all' }, 'All sources'), ...inventory.sources.map(source => h('option', { key: source.id, value: source.id }, `${source.source} · ${source.provider}`)))),
          entries.length === 0 && h('p', { style: muted }, 'No skills match this view.'),
          ...entries.map((entry, index) => h('div', { key: `${entry.sourceId}:${entry.name}:${index}`, style: row },
            h('span', { 'aria-hidden': true, style: { ...control, borderRadius: '50%', flexShrink: 0 } }, '◇'),
            h('button', { style: { flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer' }, onClick: () => setSelected(entry) }, h('strong', null, entry.name), h('div', { style: { ...muted, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginTop: 5 } }, entry.description), h('div', { style: { ...muted, marginTop: 4 } }, `${entry.source} · ${entry.status}${entry.access.recorded ? ' · DSH rule recorded' : ' · Approval not recorded'}`)),
            modeSelect(`${entry.name} DSH access`, entry.access.mode, mode => void change(entry, entry.sourceId, mode), busy || inventory.needsReview || !inventory.complete || !inventory.writable || entry.status !== 'winner'))))
          : h('div', null, ...inventory.sources.map(source => h('div', { key: source.id, style: { ...row, alignItems: 'flex-start', flexWrap: 'wrap' } }, h('div', { style: { flex: 1, minWidth: 160 } }, h('strong', null, source.source), h('p', { style: { ...muted, overflowWrap: 'anywhere' } }, source.origin), h('p', { style: muted }, `Provider: ${source.provider}. ${source.watched === undefined ? 'Watcher status not recorded.' : source.watched ? 'Root is watched.' : 'Watcher disabled.'} Future entries inherit source defaults. Per-skill rules may differ.`)), modeSelect(`${source.source} source access`, source.mode, mode => void change(null, source.id, mode), busy || inventory.needsReview || !inventory.complete || !inventory.writable)))),
        inventory.diagnostics.length > 0 && h('details', null, h('summary', null, `${inventory.diagnostics.length} discovery diagnostics`), ...inventory.diagnostics.map((diagnostic, index) => h('p', { key: index, style: { ...muted, overflowWrap: 'anywhere' } }, `${diagnostic.path ?? diagnostic.provider}: ${diagnostic.message}`))),
        h('p', { style: muted }, inventory.scope),
        h('p', { style: muted }, boundary),
        h('p', { style: muted }, 'Manage MCP connections and plugin installation in their existing Settings sections. A skill supplies instructions; it does not establish an account connection.'))),
    selected && inventory && h(Detail, { key: `${JSON.stringify(selection)}:${selected.sourceId}:${selected.name}`, entry: selected, selection, request, close: () => setSelected(null) }),
    migration && inventory && h(Migration, { request, selection, close: () => setMigration(false), done: () => { setMigration(false); void refresh() } }))
}
function Detail({ entry, selection, request, close }: { entry: Entry; selection: Selection; request: Request; close: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<SkillAccess['detail']>> | null>(null)
  const [context, setContext] = useState<ContextView | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  useEffect(() => { if (!selection.sessionId) return; let active = true; request<ContextView>('context', { sessionId: selection.sessionId }).then(value => { if (active) setContext(value) }).catch(error => { if (active) setContextError(errorText(error)) }); return () => { active = false } }, [selection.sessionId])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let active = true; setDetail(null); setError(null); request<Awaited<ReturnType<SkillAccess['detail']>>>('detail', { ...selection, source: entry.sourceId, name: entry.name }).then(value => { if (active) setDetail(value) }).catch(error => { if (active) setError(errorText(error)) }); return () => { active = false } }, [JSON.stringify(selection), entry.sourceId, entry.name, request])
  const definition = detail?.entry ?? entry
  return h(Modal, { title: definition.name, close }, h('p', null, definition.description), h('p', { style: muted }, `${definition.source} · ${definition.provider} · ${definition.status} · ${entry.access.mode}`),
    h('p', { style: { ...muted, overflowWrap: 'anywhere' } }, definition.path ?? definition.sourceIdentity?.origin ?? 'Source location not recorded'),
    h('p', { style: muted }, `Resource version: ${definition.sourceIdentity?.version ?? 'Not recorded'}`), h('p', null, entry.access.reason),
    ...entry.access.rules.map((rule, index) => h('p', { key: index, style: muted }, `${rule.scope.kind}: ${rule.mode}; ${rule.action} local action recorded ${rule.at}`)),
    contextError && h('p', { role: 'alert' }, `Context unavailable: ${contextError}`),
    h('p', { style: muted }, !selection.sessionId ? 'Select a conversation to inspect instruction loads.' : !context ? 'Reading conversation presence…' : `${context.loads.filter(load => load.name === entry.name && load.status === 'current').length} current instruction occurrences with this name. Historical loads retain their recorded source; unknown origins are not assumed to match this definition.`),
    h('p', { style: muted }, 'Feature requirement: not recorded. Bundled or plugin supplied does not mean required.'),
    error ? h('p', { role: 'alert' }, error) : !detail ? h('p', { role: 'status' }, 'Loading instructions…') : detail.content === null ? h('p', null, detail.reason) : h('pre', { style: { ...control, padding: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.6 } }, detail.content), detail?.truncated && h('p', { role: 'status', style: muted }, 'Preview limited to 256 KiB. Open the source file for the complete instructions.'),
    h('p', { style: muted }, entry.managed ? 'Manage updates and removal under Imported copies. Historical resources are retained.' : 'This is an external source. These rules control this plugin’s entry points; removing it from another application is not an uninstall action here.'), h('p', { style: muted }, boundary))
}
function Migration({ request, selection, close, done }: { request: Request; selection: Selection; close: () => void; done: () => void }) {
  const [mode, setMode] = useState<AccessMode>('off')
  const [preview, setPreview] = useState<Awaited<ReturnType<SkillAccess['migration']>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; setPreview(null); setError(null); request<Awaited<ReturnType<SkillAccess['migration']>>>('migration-preview', { ...selection, mode }).then(value => { if (active) setPreview(value) }).catch(error => { if (active) setError(errorText(error)) }); return () => { active = false } }, [mode])
  return h(Modal, { title: 'Review shared-source access', close }, h('p', null, 'Choose how this plugin should use the sources listed below. Review the scope and any upgrade changes before applying these global source rules.'), modeSelect('Shared-source default', mode, setMode, busy),
    preview && h('div', null, h('p', { style: muted }, preview.explanation), ...preview.sources.map(source => h('p', { key: source.id, style: { overflowWrap: 'anywhere' } }, `${source.origin}: ${source.mode} → ${mode}`))),
    error && h('p', { role: 'alert' }, error), button('Apply reviewed DSH rules', () => { if (!preview) return; setBusy(true); request('migrate', { ...selection, revision: preview.revision, mode, snapshot: preview.snapshot }).then(done).catch(error => setError(errorText(error))).finally(() => setBusy(false)) }, !preview?.complete || busy), h('p', { style: muted }, boundary))
}

export function ContextButton({ sessionId, request }: { sessionId: string; request: Request }) {
  const [open, setOpen] = useState(false)
  return h('div', null, button('Context', () => setOpen(true)), open && h(ContextPanel, { key: sessionId, sessionId, request, close: () => setOpen(false) }))
}
function ContextPanel({ sessionId, request, close }: { sessionId: string; request: Request; close: () => void }) {
  const [view, setView] = useState<ContextView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const refresh = () => {
    const id = ++generation.current
    setError(null)
    request<ContextView>('context', { sessionId }).then(value => { if (id === generation.current) setView(value) }).catch(error => { if (id === generation.current) setError(errorText(error)) })
  }
  useEffect(() => { setView(null); refresh(); return () => { generation.current++ } }, [sessionId, request])
  return h(Modal, { title: 'Conversation context', close }, button('Refresh context', refresh), error && h('p', { role: 'alert' }, error, view && ' Displayed context may be stale.'), !view && !error && h('p', { role: 'status' }, 'Reading conversation…'),
    view && h('div', { style: stack }, h('p', { style: muted }, `Observed through event ${view.capturedThroughSeq ?? 'none'}. Counts describe this conversation, not all installed skills.`),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, badge(`${view.summaryCount} skill summaries`), badge(`${view.loadedSkillCount} skills with full instructions`), badge(`${view.loadOccurrenceCount} instruction occurrences`), badge(view.toolsCount === null ? 'Tool count unavailable' : `${view.toolsCount} recorded tool schemas`)),
      h('details', null, h('summary', null, 'Current summaries'), ...view.summaries.map(summary => h('p', { key: summary.name }, h('strong', null, summary.name), `: ${summary.description}`))),
      h('details', { open: true }, h('summary', null, 'Instruction loads'), view.loads.length === 0 ? h('p', { style: muted }, 'No explicit skill-load events recorded. Manual file reads may still have introduced instructions.') : view.loads.map(load => h('div', { key: `${load.seq}:${load.name}`, style: row }, h('strong', null, load.name), h('span', { style: muted }, `${load.trigger} · ${load.status} · event ${load.seq} · turn ${load.turn ?? '?'} · source/version ${load.sourceIdentity === null ? 'not recorded' : JSON.stringify(load.sourceIdentity)}`)))),
      h('p', { style: muted }, `${view.textEstimates.method} Summaries: ~${view.textEstimates.summaries}; full instructions: ~${view.textEstimates.instructions}.`),
      h('p', { style: muted }, view.resourceReads), h('h3', null, 'Recorded requests'), h('p', { style: muted }, view.requestExplanation),
      view.requests.length === 0 ? h('p', { style: muted }, 'No request header is recorded yet.') : view.requests.map((item, index) => {
        const schemas = view.catalogs[item.seq]
        return h('details', { key: index }, h('summary', null, `Turn ${item.turn ?? '?'}, step ${item.step ?? '?'}: ${item.status}, ${schemas.length} tools`), item.usage && h('p', null, `Measured input: ${item.usage.inputTokens + (item.usage.cacheReadTokens ?? 0) + (item.usage.cacheWriteTokens ?? 0)}; output: ${item.usage.outputTokens}${item.usage.totalTokens === undefined ? '' : `; total: ${item.usage.totalTokens}`}`), item.usage && h('p', { style: muted }, `Input breakdown: uncached: ${item.usage.inputTokens}; cache read: ${item.usage.cacheReadTokens ?? 0}; cache write: ${item.usage.cacheWriteTokens ?? 0}`), ...schemas.map((schema, i) => h('p', { key: i }, h('strong', null, schema.name), `: ${schema.description}`, h('span', { style: muted }, ' · Provider attribution not recorded'))))
      })))
}
