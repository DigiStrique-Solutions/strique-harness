# @strique/dsh-branding

Compatibility (0.1.13): Tested with Harness `0.2.1-alpha.4`, Cordis `4.0.5-alpha.2`, and Schemastery `3.18.5-alpha.2`. `engines.dsh` pins this release to the tested Harness version; other versions require separate verification.

Strique visual identity and marketing persona for DeepSeek Harness.

The package contributes a `strique-branding` Host/Client row and a `strique-persona` Host row. The visual Host face serves the purple Strique symbol on a square favicon canvas at `/favicon.svg` and `/favicon-dark.svg`, the original mark at `/strique-branding/mark.svg`, and official lockups at `/strique-branding/logo-light.svg` and `/strique-branding/logo-dark.svg`, serves the Strique web app manifest at `/manifest.webmanifest`, and changes the initial HTML document title to `Strique`. Its Client face fills the sidebar mark, sidebar name, and blank-conversation hero mark Slots at priority `-10`. It also replaces the English blank-conversation headline, and keeps the renderer-owned browser title branded as `Strique` while preserving any session-title prefix. The shipped priority `0` Harness occupants remain installed as automatic fallbacks when this plugin unloads.

The mark comes from `Strique Brand Stuff/logos-variation/svg/favicon.svg`; provenance is recorded in `assets/PROVENANCE.md`. The Client preserves its natural proportions and suppresses the upstream fish-specific hover animation. The sidebar lettering uses the official vector lockups, with dark ink on light backgrounds and white ink on dark backgrounds. It follows the active Harness theme, including explicit overrides of the system preference. The favicon uses the same purple mark centered on a square canvas.

Harness `0.1.2-rc.1` has no replaceable browser-title Slot and rewrites `document.title` after Client plugins activate. The Host records the build-selected product title in document metadata before replacing the initial title. A narrowly scoped, Fiber-owned Client presenter observes only title metadata, changes that recorded product suffix to `Strique`, and restores the upstream Harness title when it unloads. This also supports builds that set a custom `DSH_CLIENT_TITLE`.

Harness also exposes no Slot or locale override for `conversation/hero.headline`. The hero mark occupant therefore anchors a second narrow presenter to the adjacent headline element. It replaces only the exact English upstream copy `Into the Unknown`, hides the adjacent `Preview` badge, leaves other locale or external copy untouched, and restores the upstream UI when the hero unmounts. There is no timer or animation. Each blank-hero mount randomly selects one line and keeps it stable while mounted:

1. `What would you like to improve today?`
2. `Ask and create ads for your brand`
3. `Find your next growth opportunity`
4. `Analyze, create, and optimize your marketing`
5. `From marketing insight to execution`
6. `Make every campaign perform better`
7. `See what to fix, create, and scale next`
8. `What should we work on next?`
9. `Plan campaigns. Create ads. Improve performance.`
10. `Ask Strique to find your next best move`

## Product persona

`prompts/strique.md` owns Strique's product identity, marketing judgment, evidence standards, authorization behavior, brand adaptation, content boundaries, correction behavior, and conversational voice. It is portable Markdown with no provider, model, machine path, or URL constants. Edit that file, rebuild, and reinstall the package to update the persona. Current product documentation, feature availability, and model metadata must be supplied by the deployment when available; the prompt does not invent missing facts. MCP discovery and tool routing remain owned by their capability packages.

The `@strique/dsh-branding/persona` Host entry uses the public `system-prompt/assemble` middleware. After preset resolution, it replaces `deployment:persona-prefix` for user-facing agents, including ordinary conversation forks and existing sessions on their next assembly. It removes `harness:identity` and `harness:source` and replaces an existing `app:web-surface` section with Strique web orientation. This keeps Harness development instructions out of ordinary product conversations. The persona suffix, runtime context, tool schemas, permission guidance, and other prompt contributors remain intact. This avoids a duplicate registration and a global persona being shadowed by the selected preset.

Delegated sessions (`origin: subagent` or positive `delegationDepth`) retain their role. Harness `complete` prompt overrides are respected. Unscoped prompt previews retain their original prefix because they do not identify a user-facing agent. Other user-facing preset prefixes are intentionally replaced; use a complete prompt or disable this row for a specialized root persona.

The registration belongs to its Cordis Fiber. Disabling or removing `strique-persona` restores the original assembled persona without disabling the visual brand. The prompt is a packaged asset loaded when the module is imported; editing the installed Markdown alone is not a supported hot-edit mechanism. In-flight model calls keep their original prompt.

To disable only the persona, add this override to the profile patch:

```yaml
- id: strique-persona
  disabled: true
```

In the source checkout, `docs/activation-0.1.12.md` records installation checks, test scope, and observed limitations. Version 0.1.4 originally added the persona component to the visual package.

Version 0.1.5 applies length and format constraints to the entire response and limits next-action recommendations to analysis and advice. The earlier GLM-5.2 comparisons cover 0.1.4; model-quality evaluation of the revised prompt on GLM-5.3-Flash is pending.

Version 0.1.6 restores the upgraded 0.1.4 visual behavior from source revision `c8b90b5`: the Preview badge is hidden and each hero mount selects a random headline. It retains the 0.1.5 persona unchanged. Future releases must preserve both the visual regression checks and the persona assembly checks.

Version 0.1.7 revises the product prompt following the Anthropic comparison and corrects the assembled identity and development-context handling. It consolidates repeated instructions and removes the task-specific ROAS definition. The 0.1.6 visual implementation remains unchanged. Installation and behavior evidence are recorded in `docs/activation-0.1.7.md`; historical ratings and GLM-5.2 results do not establish quality for this revision.

Version 0.1.8 changes no plugin behavior. It restores compatibility with the current Harness: the pinned peer versions move to Harness `0.1.7-alpha.1` and Cordis `4.0.3`, the development links and the packed-artifact verifier now target the `harness` sibling checkout, and the TypeScript configuration enables `allowImportingTsExtensions` because Harness Client packages now emit declarations that preserve `.ts` import extensions. The visual and persona implementations are unchanged from 0.1.7. Compatibility evidence is recorded in `docs/activation-0.1.8.md`.

Version 0.1.9 updates the compatibility pins to Harness `0.1.7-rc.2` and Cordis `4.0.4`. The visual and persona implementations remain unchanged. Compatibility evidence is recorded in `docs/activation-0.1.9.md`.

Version 0.1.10 restores activation on Harness `0.2.0-rc.1`. It updates the tested compatibility pins, replaces sibling-checkout development links with exact published packages, and verifies the browser renderer from its published Client artifact. A package regression test now runs Harness admission against the same installed runtime used by the tests, without an exemption. The visual and persona implementations are unchanged.

Version 0.1.12 targets Harness `0.2.1-alpha.1`. The sidebar wordmark fits the shell’s 24px identity row, with padding around the vector crop to avoid clipping. The chat running whale is replaced by the purple Strique mark while preserving the elapsed time and accessibility announcements. The mark pulses gently, stays static under reduced motion, uses current ink in forced colors, and restores the Harness decoration when the plugin unloads. This presenter uses the current `data-chat-running` DOM structure because Harness has no running-icon Slot; revalidate that structure on upgrades.

## Compatibility

- DeepSeek Harness `0.2.1-alpha.4`
- Cordis `4.0.5-alpha.2`
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.28.5`
- Web Client platform

Harness is prerelease software. Revalidate the Client loader artifact and Slot contracts before changing the pinned Harness version.

## Build and verify

```sh
pnpm install
pnpm run check
```

`check` runs type checking, lint, coverage-gated tests, both builds, and the package and lazy-CJS Client artifact verifier. Development dependencies are exact published versions; a sibling Harness checkout is not required. The admission test must pass whenever the tested Harness version changes.

The packed-artifact verifier uses the same published runtime dependencies. Install a packed artifact into an isolated `eval` profile, then run `STRIQUE_EVAL_HOME=<isolated DSH_HOME> node evals/verify-artifact.mjs` to verify Loader activation, persona assembly and two removal/reload cycles.

## Removal

Remove the package through the Harness plugin CLI, then restart the profile:

```sh
dsh plugin --profile <profile> remove @strique/dsh-branding
```

Removal deletes the bundle layer on the next profile start. The persona listener withdraws, restoring the prior persona. The Host routes and initial-title transform disappear, the Client title presenter restores the upstream product suffix, the hero presenter restores the upstream English headline, and the Strique Slot occupants withdraw so the existing Harness branding renders again.
