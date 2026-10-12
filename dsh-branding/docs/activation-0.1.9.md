# Harness compatibility 0.1.9

Date: 2026-09-25. Package 0.1.9 updates the compatibility pins for the sibling Harness checkout at `0.1.7-rc.2` and Cordis `4.0.4`. The visual and persona source, prompt, assets, and bundle patch are unchanged from 0.1.8.

## Changes

- The optional Harness peer dependencies now require exact version `0.1.7-rc.2`; the Cordis peer requires `4.0.4`.
- Package contract and packed-artifact checks expect plugin version `0.1.9`.
- The development dependencies remain linked to `../harness`; the lockfile needs no change because it records those links rather than the linked packages' versions.

## Contract and build checks

The `0.1.7-rc.2` checkout still provides `webServer.register` and `tapIndex`, the `system-prompt/assemble` waterfall and `PERSONA_PREFIX_SECTION`, and the Client `slots.inject`/`slots.register` APIs. The sidebar mark/name and conversation hero mark Slots retain their owner-props types. The English hero still renders `Into the Unknown` and the adjacent `Preview` badge in the structure used by the Client presenter.

`pnpm run check` passed: typecheck, oxlint, all 22 tests, coverage gates, Host and Client builds, and the package and lazy-CJS Client artifact verifier. Coverage was 99.31% statements, 95.31% branches, and 100% functions and lines. The Client bundle was 5,852 bytes raw and 2,053 bytes gzip.

`pnpm pack` produced `strique-dsh-branding-0.1.9.tgz` (SHA-256 `0716c0d2bd263ae8404c45be1e6737c6edaa2b7187240d385bafc72286573292`). The Harness CLI installed it with `--ignore-scripts --offline` into a disposable `eval` profile under a temporary `DSH_HOME`. `STRIQUE_EVAL_HOME=<temporary DSH_HOME> node evals/verify-artifact.mjs` loaded both rows as ACTIVE through the real Loader, checked the packed persona and favicon, and completed two unload/reload cycles that restored the original prompt and routes.

Tested against Harness commit `477b4f420553e8a52c2fbccc464d7561b239c443`, Node `24.21.0`, and pnpm `11.7.0`. No live profile or model call was used. The packed-artifact check does not start a browser; Client behavior is covered by the local React tests and bundle verifier.
