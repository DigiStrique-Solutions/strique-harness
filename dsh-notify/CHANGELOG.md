## 0.1.5 — 2026-10-16

## 0.1.6 — 2026-10-21

Target Harness `0.2.1-rc.2` and its current Cordis package versions.

Align Harness dependencies and lockfiles with `0.2.1-alpha.4` and declare exact runtime support in `engines.dsh`.

# Changelog

## 0.1.4 (2026-10-05)

- Target Harness `0.2.1-alpha.1`, Cordis `4.0.5-alpha.1`, and Schemastery `3.18.5-alpha.1` and refresh the dependency lockfile.
- Preserve existing plugin behavior; compatibility checks pass without exemptions.

## 0.1.4 (2026-09-29)

- Restore compatibility with Harness 0.2.0-rc.1 by updating the settings peer and matching development dependency.
- Add a regression test using the actual Harness admission checker without exemptions.
- Update browser verification for the current Preview Notice and verify notification, audio scheduling, settings, and unload/reload behavior through the installed artifact.
- No notification runtime or permission behavior changes.

## 0.1.3 (2026-09-25)

- Update compatibility to Harness 0.1.7-rc.2, Cordis 4.0.4, and Schemastery 3.18.4.
- Bind the Notifications page translator when registering its settings slot; Harness supplies owner props to the page component.
- Refresh the lockfile and local bundle for the rc.2 dependency set.

## 0.1.2 (2026-09-22)

Compatibility release for Harness **0.1.7-alpha.1** (Cordis 4.0.3, Schemastery 3.18.3).

- Host: `ctx.settings.register` was removed in 0.1.7. The plugin's `Config` schema is now projected into a settings form automatically; the host half only suppresses the auto-generated form page (`ctx.settings.configure({ auto: false })`, soft-injected) because the browser half renders its own Notifications page.
- Client: `ctx.settingsScope` was replaced by `ctx.configForms` in 0.1.7. Preference mirroring now writes through `ctx.configForms.get("dsh-notify")`; localStorage remains the primary store.
- Client: `ctx.uiSession.pendingInteractions` was replaced by `ctx.uiSession.sessionStatus`. Questions, plan reviews, and approvals are now read from each session's `pendingInteraction` in the status snapshot.
- Client: service `inject` list updated (`configForms`, `remote` instead of `settingsScope`) and `@deepseek-ai/dsh-api-remotes` added to the declared client bundle dependencies.
- Tests updated to the 0.1.7 service shapes; behavior (chimes, notifications, preferences, cleanup) is unchanged.

## 0.1.1 (2026-09-15)

First DigiStrique Solutions release, based on dshiq04/dsh-notify commit `50c36dc969c7c0ef28b5b98f5fbc873669be3496`.

- Support Harness 0.1.6-alpha.1 settings registration and browser service metadata.
- Alert on completion, questions, plan reviews, and permission approvals using the current session services.
- Provide English notification messages, settings, and documentation.
- Ship a directly installable Cordis bundle with prebuilt Host and Client entry points.
- Dispose subscriptions, styles, settings contributions, and audio resources during unload.
- Pin portable development dependencies and include lifecycle and browser verification.

Preference storage remains shared by browser origin with optional Host mirroring. Tenant/account scoping, RBAC, preview privacy, logout cleanup, and closed-tab push delivery are deferred.

## 0.1.0

Original upstream plugin by QING (dshiq04).
