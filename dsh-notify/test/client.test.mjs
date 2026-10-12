import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    push: next => { value = next; for (const fn of listeners) fn(); },
    listeners
  };
}

function setup({ pending = new Map(), preferences = {} } = {}) {
  const notifications = [], notes = [], styles = new Set(), listeners = new Set(), effects = [];
  let dictionary, view, audioClosed = 0, handoff;
  const stored = new Map([['dsh-notify/settings/v1', JSON.stringify(preferences)]]);
  const sessions = observable({ byId: { A: { id: 'A', displayTitle: 'Example', running: true } } });
  // SessionStatus snapshot shape of `ctx.uiSession.sessionStatus` (dsh 0.1.7):
  // Map<sessionId, { running, pendingInteraction, completionUnread }>.
  const toStatus = entries => new Map([...entries].map(([id, interaction]) => [id, { running: true, pendingInteraction: interaction, completionUnread: false }]));
  const status = observable(toStatus(pending));
  const interactions = {
    push: entries => status.push(toStatus(entries)),
    listeners: status.listeners
  };
  const document = {
    visibilityState: 'hidden',
    createElement: () => { const tag = { dataset: {}, remove: () => styles.delete(tag) }; return tag; },
    head: { appendChild: tag => styles.add(tag) }
  };
  const window = {
    __ModuleLoader__: { load: value => { handoff = value; } },
    addEventListener: type => listeners.add(type),
    removeEventListener: type => listeners.delete(type),
    AudioContext: class {
      state = 'running'; currentTime = 0; destination = {};
      close() { audioClosed++; return Promise.resolve(); }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { const note = { frequency: {}, connect() {}, start() {}, stop() {} }; notes.push(note); return note; }
    }
  };
  const Notification = class {
    static permission = 'granted';
    constructor(title, options) { notifications.push({ title, ...options }); }
  };
  runInNewContext(source, {
    window, document, Notification, console,
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  });
  const jsx = (type, props) => ({ type, props });
  const plugin = handoff.factory(name => {
    if (name === 'react') return { useSyncExternalStore: (_, get) => get(), useState: value => [typeof value === 'function' ? value() : value, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' };
    throw new Error(`Unexpected import ${name}`);
  });
  const ctx = {
    effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; },
    locale: { register: (_, dictionaries) => { dictionary = dictionaries.en; assert.deepEqual(Object.keys(dictionaries), ['en']); return () => {}; }, bind: () => key => dictionary[key] },
    configForms: { get: () => ({ set: () => Promise.reject(new Error('Host settings unavailable')) }) },
    sessions: { list: sessions }, uiSession: { sessionStatus: status },
    slots: { inject: (_, fn) => ctx.effect(fn), register: (_, component) => { view = component; return () => { view = undefined; }; } }
  };
  const mount = () => plugin.apply(ctx);
  const dispose = () => { for (const fn of effects.splice(0).reverse()) fn?.(); };
  mount();
  return { notifications, notes, styles, listeners, sessions, interactions, document, stored, mount, dispose,
    audioClosed: () => audioClosed, render: () => {
      // The Harness settings slot supplies its owner props, not a translator.
      const section = view({ close: () => {} });
      return typeof section.type === 'function' ? section.type(section.props) : section;
    } };
}

test('current pending service alerts once per request, including initial and replacement requests', () => {
  const h = setup({ pending: new Map([['A', { key: 'approval-1', kind: 'approval' }]]) });
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].body, /waiting for your approval/);
  h.interactions.push(new Map([['A', { key: 'approval-1', kind: 'approval' }]]));
  assert.equal(h.notifications.length, 1);
  h.interactions.push(new Map([['A', { key: 'question-2', kind: 'question' }]]));
  assert.match(h.notifications.at(-1).body, /waiting for your answer/);
  h.interactions.push(new Map([['A', { key: 'plan-3', kind: 'plan-review' }]]));
  assert.match(h.notifications.at(-1).body, /review the plan/);
  assert.equal(h.notifications.length, 3);
  assert.equal(h.notes.length, 9);
  assert.ok(h.notes.every(note => note.type === 'square'));
  h.dispose();
});

test('completion uses session list and a different chime; subagent completions stay silent', () => {
  const h = setup();
  h.sessions.push({ byId: { A: { id: 'A', running: false }, B: { id: 'B', running: true, origin: 'subagent' } } });
  assert.equal(h.notifications.length, 1);
  assert.ok(h.notes.every(note => note.type === 'sine'));
  h.sessions.push({ byId: { B: { id: 'B', running: false, origin: 'subagent' } } });
  assert.equal(h.notifications.length, 1);
  h.dispose();
});

test('disabled and foreground-only preferences suppress alerts', () => {
  for (const preferences of [{ enabled: false }, { onlyWhenHidden: true }]) {
    const h = setup({ preferences });
    h.document.visibilityState = 'visible';
    h.interactions.push(new Map([['A', { key: 'one', kind: 'question' }]]));
    assert.equal(h.notifications.length, 0);
    assert.equal(h.notes.length, 0);
    h.dispose();
  }
});

test('unload removes styles, observers and audio; remount contributes once', () => {
  const h = setup();
  h.interactions.push(new Map([['A', { key: 'one', kind: 'approval' }]]));
  h.dispose();
  assert.equal(h.styles.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.sessions.listeners.size, 0);
  assert.equal(h.interactions.listeners.size, 0);
  assert.equal(h.audioClosed(), 1);
  h.interactions.push(new Map());
  assert.equal(h.notifications.length, 1);
  h.mount();
  assert.equal(h.styles.size, 1);
  assert.equal(h.interactions.listeners.size, 1);
  h.dispose();
});

test('English settings persist locally when the optional host mirror rejects', async () => {
  const h = setup();
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat().flatMap(walk)];
  const tree = h.render();
  const volume = walk(tree).find(node => node.props?.type === 'range');
  volume.props.onChange({ target: { value: '85' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(h.stored.get('dsh-notify/settings/v1')).volume, 85);
  assert.doesNotMatch(JSON.stringify(tree), /[\u3400-\u9fff]/u);
  h.dispose();
});
