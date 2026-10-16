# Strique Harness distribution builds

Source snapshot of the DeepSeek Harness and eight Strique plugins, with standalone browser-interface installers.

The current snapshot uses Harness `0.2.1-alpha.4` and updates Branding, Codex CLI, MCP Manager, Memory, Notify, and Skills Manager for that runtime. Univer and BetterSidebar retain their prior source snapshots. [Source revisions](setup/source-revisions.json) record the upstream commits included in this refresh.

Installer owner-state updates use atomic replacement so concurrent launch/status readers cannot observe partially written JSON.

Known limitation: the unchanged BetterSidebar snapshot remains pending on Harness `0.2.1-alpha.4` because it requires the removed `webRuntime` service. Updating that excluded plugin is separate work.

## Build a Windows installer

1. Open **Actions → Build Windows installer → Run workflow**.
2. Set a product version such as `0.1.0`. Leave the update URL empty until hosting is configured.
3. Download the `strique-win32-x64` artifact from the successful run and extract its `.exe`.

The installer bundles Node, the harness, and the configured plugins. End users do not need GitHub accounts or a separate Node installation. These are unsigned development installers.

The **Build Strique installers** workflow builds all five supported OS/architecture targets. See [standalone documentation](setup/standalone/README.md) for installation, signed updates, and limitations.

## Refresh the source

This repository contains a source snapshot rather than submodules. On the development machine, run `node setup/export-source.mjs NEW_OUTPUT_DIRECTORY` and review the resulting snapshot before updating this repository. Changes on the development machine reach users only after a new snapshot is committed, a release is built, and its installer or signed update is distributed.

Credentials, sessions, dependency directories, and original Git histories are excluded. Upstream license files remain in their project folders.
