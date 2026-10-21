# dsh-mem

Compatibility (1.0.2): Tested with Harness `0.2.1-rc.2`, Cordis `4.0.5`, and Schemastery `3.18.5`. `engines.dsh` pins this release to the tested Harness version; other versions require separate verification.

Persistent agent memory for the dsh harness, in the spirit of Claude memory / Codex memory: the agent learns from its mistakes, remembers preferences and durable facts, distills concepts once instead of re-explaining them, and keeps all of it small enough to be worth recalling. Ships with a Web UI panel in the Harness sidebar.

Plain JavaScript, no build step, no dependencies on harness packages. Kept fully separate from other plugins: one bundle, one storage domain (`dsh_mem`), one API route (`/api/dsh-mem/memories`), one tool (`memory`).

## What it does

- **Self-learning from mistakes.** A `tools/result` observer captures every failed tool call (rate-limited by a tool+error dedupe key) as an `observed` lesson. When the agent later articulates the fix with the same subject, the lesson is promoted to `learned` and ranked higher. Learned lessons surface in the standing digest injected into every new agent, so the same mistake is not repeated in a fresh session.
- **Token discipline.** The system-prompt section is a few static lines. The standing digest is injected once per agent (not per step), capped in characters, and lists only the top-ranked records. The `memory` tool is a single tool with an `action` discriminator instead of several tools, so its schema stays small.
- **Concepts.** Explanations the user has given once get saved as `concept` records; the digest carries their titles and `search` retrieves the full body, so the agent stops paying for re-derivations.
- **Web UI.** A sidebar Memory panel lists every record with kind filters (lessons / preferences / facts / concepts), auto-capture stats, inline editing, and delete, styled with theme tokens for light and dark.

## Architecture

| Part | Mechanism |
| --- | --- |
| Storage | `ctx.storageDomain.open` domain `dsh_mem`, `per-record` layout, `backup-and-skip` on unreadable records (records are disposable derived data; the session log remains the only source of truth) |
| Tool | `ctx.tools.register` — `memory` with `search` / `save` / `update` / `delete` / `list` |
| Standing context | `agent/created` observer + `agent.inject()` (logged as `agent/inbox/spliced`) |
| Prompt policy | `ctx.systemPrompt.section` (static, `interpolate: false`) |
| UI data | `ctx.connection.fetch.register` — authenticated exact route below `/api` |
| UI | Client module registering `sidebar.panellist` + `main` slots, locale via `ctx.locale` |

Record shape: `{ id, kind: lesson|preference|fact|concept, title, body, tags, origin: auto|model|user, status?: observed|learned, key?, occurrences?, confidence, hits, createdAt, updatedAt, lastSeenAt? }`.

## Config (row `config`, defaults in `cordis.patch.yml`)

| Field | Default | Meaning |
| --- | --- | --- |
| `digestMaxChars` | 1200 | Character budget for the standing digest |
| `standingTopK` | 12 | Max records per digest section (and `list` default) |
| `autoLessons` | true | Capture failed tool calls as observed lessons |
| `autoLessonCap` | 40 | Max auto-captured lessons kept (stalest deleted) |
| `maxMemories` | 200 | Store size cap; `save` refuses when full |
| `searchLimit` | 8 | Default `search` result count |

## Known Limitations and Deferred Work

- Memory is workspace-global; per-project scoping is deferred until there is a consumer for it.
- Recalled-memory hit counts are fire-and-forget writes; a failed write is logged and skipped.
- The UI refreshes on open/refresh-button; a live push channel is deferred.
- The bundle declares no `Config` schema export (schemastery is not importable from a plain bundle), so config values are clamped defensively in `index.js` instead of validated by the Loader.
