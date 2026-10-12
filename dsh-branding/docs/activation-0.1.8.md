# Harness compatibility 0.1.8

Date: 2026-09-22. Package 0.1.8 is a compatibility release; no plugin behavior changes.

## Why

The plugin workspace pinned Harness `0.1.5-rc.2` and Cordis `4.0.2` and linked its development dependencies to a sibling `deepseek-harness` checkout. That checkout is now named `harness`, is version `0.1.7-alpha.1` with Cordis `4.0.3`, and the stale links left the plugin uninstallable and unbuildable against the current tree.

## Changes

- `peerDependencies` move to Harness `0.1.7-alpha.1` and Cordis `4.0.3`. React, Node, and pnpm constraints are unchanged.
- Development links in `package.json` and the harness path in `evals/verify-artifact.mjs` now target `../harness`.
- `tsconfig.json` enables `allowImportingTsExtensions`. Harness Client packages build with `rewriteRelativeImportExtensions: false`, so their emitted declarations (and their declaration maps, which pull the checked program into Harness sources) keep `.ts` import extensions; consumers must allow them. Both the typecheck configuration (`noEmit`) and the declaration build (`emitDeclarationOnly`) satisfy that option's constraints.
- Source under `src/`, `prompts/strique.md`, `cordis.patch.yml`, and the assets are unchanged from 0.1.7.

Contract review before repinning found every consumed API stable in `0.1.7-alpha.1`: `webServer.tapIndex` and exact-route registration, the `system-prompt/assemble` event and `PERSONA_PREFIX_SECTION`, `slots.inject`/`slots.register`, the `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` slots with their owner-props types, and the hero DOM structure around the `Into the Unknown` headline.

## Verification

- `pnpm run check` passed against the linked Harness checkout: typecheck, oxlint, all 22 tests, coverage gates (100% lines/functions, 99.31% statements, 95.31% branches), both builds, and the package and lazy-CJS Client artifact verifier.
- The packed artifact was verified end to end: `pnpm pack` produced `strique-dsh-branding-0.1.8.tgz`; the CLI installed it into a disposable Harness `eval` profile with `--ignore-scripts`; `STRIQUE_EVAL_HOME=<temporary DSH_HOME> node evals/verify-artifact.mjs` reported both rows ACTIVE through the real Loader, the assembled Strique persona replacing the original with tools preserved, favicon routes live, and two removal/reload cycles restoring the original prompt and routes. The disposable profile was then removed through the CLI.
- The live `web` profile was not modified. No browser smoke or model check was run; the persona and visual implementations are byte-identical to the tested 0.1.7 release, and their behavior evidence is recorded in [activation-0.1.7.md](activation-0.1.7.md).

Tested against Harness `0.1.7-alpha.1` at `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`, Cordis `4.0.3`, and Node `24.21.0`. The plugin workspace used pnpm `11.7.0`; the disposable profile install used the Harness-managed pnpm `11.24.0`. Other runtime versions were not tested.

## Upgrade

Rebuild and reinstall the package into the target profile, then restart the profile, as in prior activations. No configuration or profile-patch changes are required.
