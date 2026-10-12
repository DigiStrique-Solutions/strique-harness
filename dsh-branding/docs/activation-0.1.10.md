# Harness compatibility 0.1.10

Date: 2026-09-28. This release restores Strique branding on Harness `0.2.0-rc.1`, with Cordis `4.0.4`.

## Cause and repair

Version 0.1.9 declared exact Harness `0.1.7-rc.2` peers. The current Harness rejected those peers, and the live profile had the bundle disabled. Its unit tests did not check runtime admission. Development dependencies and artifact verification also depended on a sibling Harness checkout.

Version 0.1.10 pins the tested Harness release, uses exact published development dependencies, loads the published Client renderer in tests, and verifies admission through the real Harness compatibility checker. The visual and persona implementations, artwork, and bundle patch are unchanged. Future Harness versions still require compatibility verification and a corresponding package update.

## Evidence

The admission regression failed with the old peer declarations and passed with the repaired manifest. `pnpm run check` passed typecheck, lint, all 23 tests, coverage gates, both builds, and the lazy-CJS artifact checks. Coverage: 99.31% statements, 95.31% branches, 100% functions and lines.

A packed tarball was installed using the supported Harness CLI with install scripts disabled into an isolated profile. The real Loader activated the branding and persona rows. The verifier checked favicon routes, persona assembly, tool preservation, and two unload/reload cycles with route and prompt restoration.

A second isolated profile included the live enabled bundles, including Better Sidebar 0.24.1. The shared `qa-browser` harness checked the title, sidebar wordmark, hero headline and logo, exact SVG route contents, web manifest, reloads, duplicate prevention, loaded plugin state, sidebar interaction, and absence of browser errors. Desktop light and dark screenshots and a 390px viewport were visually inspected. The baseline against the unmodified live server failed the branded title assertion as expected.

The browser test waits for onboarding to settle before interacting. An earlier immediate visibility check raced the preview notice and produced misleading screenshots and a blocked sidebar click; waiting for the notice and dismissing it resolved this test issue without product changes.

Evidence logs and the browser spec are retained under the local repair directory and the shared browser QA harness. No model-quality evaluation was run because the persona prompt is unchanged.

## Live activation

The supported CLI installed the final tarball into the existing web profile, after backing up its manifest, lockfile, patch, and launcher. The public profile writer re-enabled the compatible bundle without overriding admission. Harness was restarted on port 3080 and authenticated HTTP plus loaded-bundle checks passed. The same browser test passed against the live profile. All 130 pre-existing session files remained present; browser testing did not send a model message. The temporary server on port 3239 was stopped after verification.

Live installation artifact: `.dsh/artifacts/branding/0.1.10/strique-dsh-branding-0.1.10.tgz` relative to the parent workspace. Rollback profile files: `.dsh/backups/branding-0.1.10-20260928`. Repair evidence: `.dsh/repairs/branding-20260928`.
