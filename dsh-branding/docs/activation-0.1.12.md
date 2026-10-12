# Current Harness and Strique visuals 0.1.12

Date: 2026-10-05. Harness `0.2.1-alpha.1`, Cordis `4.0.5-alpha.1`.

The prior exact Harness pins caused admission rejection on the current runtime. Published dependencies and Cordis support packages now match the checkout, and the lockfile is refreshed. The current Harness admission check passes without an exemption.

The sidebar shell clips its branding to a 24px row. The previous 28px wordmark exceeded that row. The presenter now uses a 24px viewport and a padded lettering crop, preserving the original vector assets. The running-status presenter replaces the whale decoration with the Strique prism using the existing `data-chat-running` structure. It preserves the timer and live announcements, disables the pulse for reduced motion, supports forced colors, and removes its stylesheet on disposal. No Harness source files changed.

Verification:

- Type checking, linting, Host and Client builds, and packaged Client loader verification passed.
- All 25 tests passed; coverage: 100% lines/functions, 99.36% statements, 95.31% branches.
- Headless Chrome rendered the built Client occupants with the current Harness sidebar and chat CSS. The logo occupied exactly the 24px row. Light/dark variants, the Strique running mark, reduced motion, timer preservation, and stylesheet removal passed. Screenshots were inspected and are stored in the parent workspace at `Workspace-dsh/verification/strique-current-harness/`.
- The existing web profile links this checkout, so the built changes load on its next start. No running process was restarted.

The running-icon presenter depends on the current DOM structure because there is no running-icon Slot. Revalidate it when upgrading Harness.
