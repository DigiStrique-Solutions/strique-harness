# Harness 0.2.1-alpha.4 verification, 2026-10-16

Dependency pins and `engines.dsh` target Harness `0.2.1-alpha.4`. Syntax, behavior, and real Harness service integration checks pass without version exemptions. No running user profile was changed.

# 0.4.2: Harness 0.2.1-alpha.1 verification, 2026-10-05

Exact published Harness dependencies target `0.2.1-alpha.1`; Cordis support packages and lockfiles match the current checkout. `pnpm test`: Host and Client builds and all 83 tests passed, including HTTP security, runtime access policies, context inspection, and lifecycle checks. The current checkout’s `evaluatePluginCompatibility` admits the plugin without exemptions. The existing web profile links this checkout. No running process was restarted.

# Harness 0.2.0-rc.2 verification, 2026-10-01

Exact published Harness dependencies and overrides now target `0.2.0-rc.2`; the lockfile was regenerated. `pnpm test` rebuilt Host and Client successfully; all 83 tests passed with `node --test test/*.test.mjs` after rerunning with local HTTP server access. Harness admission passes without exemptions. No running profile was changed.

# 0.4.1 compatibility verification, 2026-09-25

Compatibility target: official Harness 0.1.7-rc.2 (local checkout `477b4f4205`), Cordis 4.0.4, Node 22.23.3 and 24.21.0, pnpm 10.33.0. The package lockfile resolves published Harness packages rather than local workspace links.

`npm test` rebuilt Host and Client artifacts and passed all 83 tests, including a localhost HTTP security test. The migration updates cold preset reads to use an acquired scope lease and projects the current tool-result message format. This suite does not replace an installed Web or Desktop smoke test; the earlier assembled and browser checks below were performed on 0.1.6-alpha.1.

# 0.4.0 plugin-only verification, 2026-09-16

Compatibility baseline: official unmodified Harness 0.1.6-alpha.1 at upstream revision `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`, Cordis 4.0.2, macOS, Node 26.4.0, pnpm 10.33.0. Other prereleases are not claimed compatible until tested.

`pnpm test` builds both Host and Client artifacts and passes 82 tests. Coverage includes cached input totals, stale Context responses and conversation changes, coherent previews, atomic grouped updates and storage limits, policy migration/failures, official registry compatibility, initial readiness deadlines, empty catalogs, manual-only skills, parent/child progressive loading, competing preset tools, cancellation/unload, policy withdrawal/restoration, deleted/unrelated preset rules, source versus skill overrides, and replayed catalog changes.

Test-first evidence includes failures against official packages for missing pre-dispatch catalogs, legacy policy migration, and preset tools bypassing plugin rules, followed by passing implementations. The full suite also retains import, filesystem, authentication, concurrency and lifecycle regressions.

Packed plugins installed through the real Harness CLI into an isolated home with its supported hoisted linker and automatic peer installation disabled. Do not hand-create profiles using plain pnpm defaults: duplicate Harness service/scope module instances invalidate composition.

The assembled web profile passed real standard-preset parent and child conversations using a deterministic adapter, progressive summary/body checks and policy-denied manual/tool loading. All four manager/Langfuse rows reached ACTIVE. Packed Loader tests passed three withdrawal/restoration cycles with no unexpected PENDING or FAILED rows, one HTTP route and complete cleanup. Browser smoke plus three feature flows passed: installed inventory/preview, cache-inclusive usage with reversed refresh responses, and one-batch shared-snapshot Update all.

The separate Langfuse plugin passes 171 tests, including exact prepared inputs, privacy modes, failed redaction and capture withdrawal; it uses official telemetry plus public middleware. Its clean package import/composition check also passes.

These checks are evidence for the covered behavior, not a guarantee of zero bugs. They use a deterministic model and do not claim a paid-provider conversation. External providers expose winners without immutable revisions or watcher diagnostics. Access applies to this plugin’s entry points, not unrelated registry/filesystem reads; uninstall restores upstream behavior. Legacy nonempty source rules require review unless a deployment supplies a verified permission-preserving identity translation.

Reproduce package checks:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm pack --pack-destination artifacts
```

Local assembled/browser evidence is recorded under the parent workspace's `research/skills-context-audit-20260916/plugin-only`. Authentication, deployment profiles and raw request inputs are private evidence and must not be committed. The earlier 0.3.x paired-core implementation is superseded and its core PR is closed.
