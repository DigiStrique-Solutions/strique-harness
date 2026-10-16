# dsh-notify

Compatibility (0.1.5): Tested with Harness `0.2.1-alpha.4`, Cordis `4.0.5-alpha.2`, and Schemastery `3.18.5-alpha.2`. `engines.dsh` pins this release to the tested Harness version; other versions require separate verification.

English browser notifications and distinct sounds for DeepSeek Harness. Maintained by DigiStrique Solutions. This fork starts from [dshiq04/dsh-notify](https://github.com/dshiq04/dsh-notify), commit `50c36dc969c7c0ef28b5b98f5fbc873669be3496`.

## Compatibility

Targets Harness **0.2.1-alpha.4**, Cordis **4.0.5-alpha.2**, and Schemastery **3.18.5-alpha.2**. Older Harness releases are not supported by this fork. No Harness source patch is required.

- The Host declares the notification preferences as its `Config` schema; the Harness settings service projects them into a settings form automatically. The auto-generated page is suppressed because the plugin renders its own page.
- The Client reads completion transitions from `ctx.sessions.list` and keyed questions, plan reviews, and approvals from `ctx.uiSession.sessionStatus` (each session's `pendingInteraction`). Preference mirroring uses `ctx.configForms`.
- Settings use the existing `settings.section` slot. All plugin text is English, including when the Harness uses another language.
- The package declares an installable `dsh.bundle` and a browser `./client` entry. Runtime JavaScript is maintained directly in `lib/`; no compilation or install lifecycle script is needed.

## Development

Install the pinned development dependencies from npm. A sibling Harness checkout is not required for the Node checks. Browser integration tests require a running compatible Harness and the QA setup described in [VERIFICATION.md](VERIFICATION.md).

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
npm pack --ignore-scripts
```

`pnpm check` includes an admission regression using the tested Harness runtime without compatibility exemptions, and runs syntax checks and portable Node tests for Host registration, schema validation, current Client event handling, English settings, local persistence, and cleanup/remount behavior.

## Install the local 0.1.4 bundle

Build the bundle from this checkout, then install it into the intended Harness home and profile:

```sh
npm pack --ignore-scripts
DSH_HOME=/path/to/harness-home dsh plugin --profile web add ./dsh-notify-0.1.4.tgz --ignore-scripts
DSH_HOME=/path/to/harness-home dsh --profile web --dump-config
```

## Archived private 0.1.2 release

This older bundle targets Harness 0.1.7-alpha.1. For the current Harness, use the local 0.1.4 bundle above. The repository and release are private. Your GitHub account must have access to `DigiStrique-Solutions/dsh-notify`. Authenticate with the GitHub CLI, then download the prebuilt plugin and checksum:

```sh
gh auth status
mkdir -p dsh-notify-release
gh release download v0.1.2 --repo DigiStrique-Solutions/dsh-notify --pattern dsh-notify-0.1.2.tgz --pattern SHA256SUMS --dir dsh-notify-release
(cd dsh-notify-release && shasum -a 256 -c SHA256SUMS)
```

Use the intended Harness home and profile:

```sh
DSH_HOME=/path/to/harness-home dsh plugin --profile web add ./dsh-notify-release/dsh-notify-0.1.2.tgz --ignore-scripts
DSH_HOME=/path/to/harness-home dsh --profile web --dump-config
```

Wait for running sessions to finish, restart that profile after adding the bundle, then refresh its browser page. Open **Settings > Notifications**, request browser notification permission, and click **Play question chime** to enable and test audio. Browser audio requires a user gesture; muted tabs and system volume still apply.

Remove with:

```sh
DSH_HOME=/path/to/harness-home dsh plugin --profile web remove dsh-notify
```

Start the profile again after removal to withdraw its Client bundle.

## Behavior

- Completion: a soft ascending chime after a top-level session stops running. Subagent completion stays silent.
- Questions, approvals, and plan reviews: an urgent triple beep for each newly observed request key, including requests already pending at plugin activation.
- The settings page offers volume, sound presets, a master switch, sound-only disabling, background-only alerts, permission requests, and test buttons.
- Unloading removes the plugin's styles, subscriptions, settings contribution, and audio context.

## Preferences and deployment limits

Preference scoping is intentionally deferred. Settings still persist under the browser-origin key `dsh-notify/settings/v1` and are mirrored to the shared Host settings namespace when available. They are not separated by account or tenant.

This is a notification UI, not an authorization layer. A hosted application must filter session/event delivery and enforce approval permissions on the server. Session titles appear in desktop notification previews. There is no logout notification clearing or closed-tab Web Push delivery yet.

## Changes from upstream

Version 0.1.4 restores activation on Harness 0.2.0-rc.1 and adds a real runtime-admission regression. Notification behavior is unchanged; packed browser verification covers current session and settings services. Version 0.1.3 updates the Harness compatibility pins to 0.1.7-rc.2 and fixes the Notifications settings page's translator binding. Version 0.1.2 tracks the Harness 0.1.7-alpha.1 settings and session-status services (Config-schema settings forms, `configForms` mirroring, `uiSession.sessionStatus`). Version 0.1.1 replaces removed Host imports and obsolete Client metadata, connects the current pending-interaction service, adds bundle packaging, makes plugin text and documentation English-only, and replaces machine-specific tests. Local preference storage and optional Host mirroring remain in place.

## Distribution and license

Distributed as a prebuilt archive attached to private GitHub releases. The package keeps `private: true` to prevent accidental npm publication. No install-time scripts or compilation are required.

MIT license, retaining upstream attribution. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
