# Theme-aware official logos 0.1.11

Date: 2026-09-29. Harness 0.2.0-rc.1, Cordis 4.0.4.

The previous sidebar lettering embedded an older JPG and used a CSS mask. This release replaces it with the official vector lockups from the supplied brand kit. Source `dark.svg` is dark ink for light backgrounds; `light.svg` is white ink for dark backgrounds. Both files are vendored byte-for-byte, with hashes in `assets/PROVENANCE.md`.

Harness has separate mark and name Slots. The name presenter frames only the lettering from each lockup and preserves the source vector paths and colors. The standalone prism and favicon remain the official artwork. Selection follows Harness's active `data-ds-dark-theme` attribute rather than the OS preference, so app theme overrides work. The styles are owned by the React presenter and disappear on unmount. No new listener or service is needed.

Verification:

- Typecheck, lint, all 24 tests, coverage gates, builds, and lazy-CJS artifact validation pass.
- Exact-byte Host route checks cover both variants, HEAD, rejected methods, and disposal. Package checks verify both source hashes and the absence of embedded raster images.
- The supported CLI installs the packed artifact with scripts disabled. The real Loader activates both rows and completes two removal/reload cycles with prompt and route restoration.
- Shared browser QA passes for desktop light/dark, a 390px viewport, assets, title, sidebar, reload, and browser errors. Screenshots were visually inspected.
- Browser QA switches System mode without reloading, selects Dark while the OS is Light, selects Light while the OS is Dark, and restores System. Exactly the correct variant remains visible in each case.

Artifact: parent workspace `.dsh/artifacts/branding/0.1.11/strique-dsh-branding-0.1.11.tgz`. Evidence: `.dsh/repairs/branding-logo-20260929`. Profile backup: `.dsh/backups/branding-0.1.11-20260929`.

Live activation completed using the supported CLI and a Harness restart on port 3080. The live authenticated browser check passed against 0.1.11. The temporary verification server on port 3239 was stopped.
