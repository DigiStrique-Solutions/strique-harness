# Portable Harness setup

For separate self-contained platform installers with a bundled Node runtime,
see [standalone/README.md](standalone/README.md). The instructions below cover
the earlier source/package setup that requires Node on the destination.

One Node installer supports source and package installations on macOS, Linux,
and native Windows. These scripts were checked on the current macOS machine;
installation on a clean target and the Windows/Linux paths still need verification.

`manifest.json` records Harness 0.2.1-alpha.4, the eight plugins active in this
machine's Web profile, and their bundle order. `dsh-memory` is not included because
it is not in that profile. Each installation uses its own Harness home.

## Requirements on the target

Install Node 22.19+ or 24+ with npm. Source mode also requires Git and a C/C++
build toolchain for native dependencies (Xcode Command Line Tools on macOS,
the compiler/build tools appropriate to Linux or Windows). The Harness native
documentation lists musl-gcc for a complete Linux native build. Registry access
is required; configure private-registry authentication on the target if needed.
The installer invokes each pinned pnpm version through npm exec, without a
global pnpm installation.

## Transfer and install source

On this machine:

```sh
node setup/export-source.mjs /tmp/strique-source
```

The exporter copies current tracked files, including tracked local modifications,
and preserves executable permissions. File symlinks become ordinary files for
Windows portability. Directory symlink aliases for development tools are omitted; their tracked
targets remain in the export. It stops if any project has untracked
files, so newly written source cannot silently disappear. It excludes `.env`
files, `.npmrc`, Git history, node_modules, sessions, and authentication stores.
Review the exported source before transfer: filename filtering cannot detect
credentials embedded in ordinary source files.

Copy the resulting folder to the destination, preserving its layout. On Windows,
use a destination such as `C:\StriqueSource`. From the copied folder:

```sh
node setup/setup.mjs --mode source --dry-run
node setup/setup.mjs --mode source
```

The default source root is the parent of `setup/`; override with `--root DIR`.
Source mode installs from frozen lockfiles, builds Harness first, builds plugins
that declare a build script, and installs the plugins through `dsh plugin add`.
Plain-JavaScript plugins keep their tracked runtime files. Relative source links
such as the local LLM plugin's links to Harness remain valid in this layout.
The source folder must remain in place after installation.

## Install packages

To package all eight existing plugin builds and write their relative tarball specs
automatically, run on this machine after building the plugins:

```sh
npm exec -- node setup/pack-plugins.mjs /tmp/strique-packages
```

Copy that entire output folder to the target and run
`node setup/setup.mjs --mode packages`. This uses the pinned registry Harness
release with local plugin tarballs. The packer checks packaged entry and bundle
files; it cannot establish whether an existing build is fresh or works on another OS.

Alternatively, for registry packages or hand-picked tarballs:

Copy `setup/` alone to the target. Edit `manifest.json`: each plugin's `spec`
accepts either a registry package with an exact version or a `.tgz`
path (relative to the manifest or absolute). The Harness spec is a registry package with an exact
version. Examples:

```json
"spec": "dsh-notify@0.1.5"
```

```json
"spec": "C:\\StriquePackages\\local-dsh-mem-1.0.0.tgz"
```

`@local/dsh-mem` has a null spec deliberately: no published registry package was
established for it. The other registry specs reflect local versions, not verified
publication or account access. Provide tarballs for private/unpublished versions.
For each plugin, after installing its dependencies and building it if needed,
create a package in that plugin's directory:

```sh
npm pack --ignore-scripts
```

Transfer the resulting tarballs and set their paths in the
manifest. `--ignore-scripts` packages the existing build; it does not build it.
Package mode requires the specified Harness release and any remaining dependency
packages to be available from the configured registry. To use local unreleased
Harness changes, choose source mode.

```sh
node setup/setup.mjs --mode packages --dry-run
node setup/setup.mjs --mode packages
```

## Start and configure

The default destination is `strique-dsh-home` under your user home. Override it
with `--home DIR`. Setup prints the full launch command; for example:

```sh
node /path/to/strique-dsh-home/start.mjs
```

On Windows the same command uses a Windows path. The launcher forwards Web
arguments, so `--no-open` and `--port 8080` can be appended. It uses the terminal's
current directory as the default agent workspace.

Set provider credentials and model configuration on the target. If using Local
CLI, install and sign into its required CLI separately. Machine-specific Web
configuration, MCP server connections, skill locations, custom profile/home
patches, memory data, and old sessions are not migrated by this installer.
Review those separately and replace machine-specific paths before applying them.

The installer registers bundles through the supported CLI, restores the recorded
bundle order, and checks configuration composition without starting a server.
Successful composition does not verify model requests or every plugin's runtime
behavior. Restart and inspect the plugin panels after first launch.

Rerunning the same manifest, mode, root, and home repairs a partial setup. An
existing unrelated home or a changed setup manifest is refused; choose a new
`--home` to install another version. `--dry-run` prints commands and validates
local inputs without creating files or accessing the registry.
