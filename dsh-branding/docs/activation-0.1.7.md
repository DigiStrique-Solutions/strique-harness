# Strique product prompt 0.1.7

Date: 2026-09-14. Package 0.1.7 is installed and active in the main `web` profile. The model remains `zai / glm-5.3-flash / max`.

## Changes

The portable `prompts/strique.md` now describes Strique's product purpose, the limits of its product knowledge, evidence-based judgment, customer-brand adaptation, content boundaries, sensitive interactions, and correction of established errors. Repeated execution and communication rules were consolidated. The standalone ROAS definition was removed. The prompt contains no fixed model, cutoff date, URLs, or workstation paths. Product-support information and current capabilities are used when supplied; their availability is not fabricated by the prompt.

The Harness adapter replaces the resolved root persona, removes `harness:identity` and `harness:source`, and replaces an existing `app:web-surface` section with brief Strique web orientation. Tool instructions, permissions, dynamic working context, and other contributions remain. Delegated roles, complete overrides, and unscoped previews preserve their previous behavior. Disabling the persona restores the original assembly.

This implements the user-approved comparison in the existing Strique prompt. It does not copy Claude's identity, model-specific values, support links, detailed provider policies, or examples. Dynamic MCP capability discovery remains separate work.

## Verification

- The revised integration test first failed against 0.1.6's inherited Harness identity. It passed after the adapter change, including preservation of unrelated sections, tools, and contexts and restoration on unload.
- `pnpm run check` passed: typecheck, lint, all 22 tests, coverage gates, build, and artifact verification. Coverage: 100% lines/functions, 99.29% statements, 95.31% branches.
- The 18-file tarball contains the intended compiled exports, assets, Markdown, and package metadata. It has no install/prepare lifecycle scripts. Model and Client assets contain no workstation paths.
- Installation into a fresh temporary profile and the real Loader verified both rows ACTIVE. Two removal/reload cycles restored the original prompt and routes. CLI removal withdrew the bundle layer.
- The live profile changed only the branding dependency. Bundle order, other dependencies, profile patch, workspace configuration, and all 20 prior sessions were preserved.
- The idle server on port 3080 was restarted from PID 25471 to PID 38983 with its original arguments and environment. No other server was stopped. Listener and authenticated HTTP 200 checks passed.
- The browser smoke passed: Strique title and marks, active branding rows, no page errors, and the Preview badge hidden before and after reload.
- Packed Client JavaScript, Client source map, visual Host JavaScript, and icon bytes match 0.1.6 exactly. Visual source and assets also match their pre-change hashes.
- The installed prompt matches the source byte-for-byte. A fresh live request includes the revised prompt exactly once at the beginning. The inherited Harness identity, implementation checkout guidance, and development-server instructions are absent. The session working directory remains as dynamic context.

## Live model check and limits

Verification session: `session-8e2e4bb5-9f5f-466c-86ee-c4ad287a35f1`, titled `Strique prompt 0.1.7 activation check`.

The input asked for two short sentences explaining Strique and an exact plan price, using only conversation information and no tools. The recorded request confirms GLM-5.3-Flash with maximum reasoning effort. The response described Strique's marketing purpose, acknowledged that pricing information was unavailable, and did not invent a price or call a tool.

The response nevertheless exceeded two sentences and used an em dash. It also suggested checking a pricing page or account plans without establishing those destinations in this test. These are limitations of the observed response, not successful checks. No extra instruction was added to fit this one sample.

This is one activation smoke, not a comparison against the prior prompt, a calibrated judge score, or a Langfuse evaluation experiment. The earlier GLM-5.2 results do not establish quality for this revision. Product-specific acceptable-use requirements and the actual availability of authoritative product documentation still need their respective product and capability owners.

## Artifacts and rollback

- Prompt SHA-256: `9c59f6b9236ee72acb2bd5b6ec7a9eddf48ca665058a5973bd82f5d0f80fa197`.
- Artifact: `.dsh/artifacts/branding/0.1.7/strique-dsh-branding-0.1.7.tgz` relative to the parent workspace.
- Artifact SHA-256: `f0f2a79af2d95dab24d9977f107365a70b410e0cc5b66bce75684bcee6deeb4f`.

Live prompt captures, plugin inventory, authentication-bearing server logs, and profile backups remain in the operator's ignored `tmp/` directory. They are local activation evidence and are not included in this repository. The portable prompt is [prompts/strique.md](../prompts/strique.md); the assembly regression tests are [tests/persona.test.ts](../tests/persona.test.ts).

To repeat the packed Loader checks, build and pack the plugin, install the tarball into a disposable Harness `eval` profile, and run `STRIQUE_EVAL_HOME=<temporary DSH_HOME> node evals/verify-artifact.mjs`. The verifier uses the sibling `deepseek-harness` checkout and its built packages at the tested revision. Use the CLI to remove the bundle from that disposable profile afterward. This verifier does not call a model or modify a live profile.

The retained 0.1.6 artifact can be restored through `dsh plugin --profile web add <artifact> --ignore-scripts` followed by an authorized idle restart. It restores the previous persona and inherited Harness development context while retaining the Preview-badge fix. Use the profile's pnpm 11.7.0 installation environment.

Tested against Harness `0.1.5-rc.2` at `038674d7a2b18bc28429271dce2fa3afa03e319b`, Cordis `4.0.2`, and Node `26.4.0`. Other runtime versions were not tested.
