# Strique Harness distribution builds

Source snapshot of the DeepSeek Harness and eight Strique plugins, with standalone browser-interface installers.

The current snapshot uses Harness `0.2.1-rc.2` and updates Branding, Codex CLI, MCP Manager, Memory, Notify, and Skills Manager for that runtime. Univer `0.3.7` and BetterSidebar `0.28.0` use the pulled upstream source snapshots from the local development workspace. [Source revisions](setup/source-revisions.json) record the upstream commits included in this refresh.

Installer owner-state updates use atomic replacement so concurrent launch/status readers cannot observe partially written JSON.

This refresh passed the isolated source setup, all 14 installer lifecycle tests, and a macOS arm64 packaged browser smoke that rendered Strique branding and BetterSidebar without page errors. Platform-specific installer builds run in GitHub Actions.

## Download Strique

Open [Strique releases](https://github.com/DigiStrique-Solutions/strique-harness/releases) and expand **Assets** on the version you want. Downloads from this public repository do not require a GitHub account.

- Windows x64: download and run `strique-VERSION-win32-x64.exe`.
- macOS: download the `darwin-arm64.pkg` for Apple Silicon or `darwin-x64.pkg` for Intel.
- Linux: download the `linux-x64.tar.gz` or `linux-arm64.tar.gz`, extract it, and run `./install.sh`.

Portable archives are available for all five platforms. `SHA256SUMS.txt` lists the SHA-256 hash of every installer and archive. The packages bundle Node, Harness, and all eight configured plugins. These are unsigned development installers.

## Publish a release

1. Open **Actions → Build Strique installers → Run workflow** on the source revision to release.
2. Set a new product version, such as `1.0.0`. Leave the update URL empty unless a signed update feed is configured.
3. After all five builds and smoke checks succeed, the release job verifies all eight files, generates checksums, uploads a draft release, and publishes it as `vVERSION`.
4. Share the published release URL with users. Release assets remain available beyond the 30-day Actions artifact retention period.

Only the release job receives `contents: write`; builds retain read-only permissions. An existing release is never overwritten. If upload fails, the draft stays hidden: inspect it, remove the incomplete draft (and any tag it created), then rerun the release job. Use a new version for changes to an already published release.

The **Build Windows installer** workflow remains a Windows-only build check whose Actions artifact requires login. Use **Build Strique installers** to publish the complete public release. See [standalone documentation](setup/standalone/README.md) for installation, signed updates, and limitations.

## Refresh the source

This repository contains a source snapshot rather than submodules. On the development machine, run `node setup/export-source.mjs NEW_OUTPUT_DIRECTORY` and review the resulting snapshot before updating this repository. Changes on the development machine reach users only after a new snapshot is committed, a release is built, and its installer or signed update is distributed.

Credentials, sessions, dependency directories, and original Git histories are excluded. Upstream license files remain in their project folders.
