# Strique standalone Web installers

This packaging system ships the existing browser interface with its own Node
runtime, production Harness packages, all eight configured plugins, and pnpm.
End users do not install Node, Git, npm, or a compiler and do not need a GitHub
account. The application listens on the local machine and opens the default
browser. Model credentials and external programs used by optional integrations
(for example the Local CLI provider, MCP servers, Python-based skills, or shell
tools) must still be configured on the user's machine.

## Platform outputs

| Build host | Installer | Portable/update package |
| --- | --- | --- |
| Apple Silicon macOS | `.pkg`, installs Strique.app in Applications | `darwin-arm64.tar.gz` |
| Intel macOS | Separate `.pkg` | `darwin-x64.tar.gz` |
| Windows x64 | Per-user NSIS `.exe` | `win32-x64.tar.gz` |
| Linux x64 | Archive with `install.sh` and application-menu shortcut | `linux-x64.tar.gz` |
| Linux ARM64 | Separate archive with `install.sh` | `linux-arm64.tar.gz` |

Build on each target OS and architecture. Linux builds depend on the distribution's
libc and system libraries; the supplied workflow uses Ubuntu 24.04 with glibc.
These archives are not Alpine/musl releases. macOS Intel and Windows/Linux artifacts
require their native build hosts; a successful Mac build does not qualify them.
Windows ARM64 and Linux `.deb`/`.rpm` installers are not currently implemented.

The native installers are unsigned development packages. Public distribution
requires your Apple signing/notarization and Windows signing setup. Update-feed
signatures implemented here are separate from operating-system code signing.

## Build locally

Install developer prerequisites and build the source trees first. From the folder
containing `harness/`, the eight plugin folders, and `setup/`:

```sh
node setup/setup.mjs --mode source --home /path/to/temporary-build-home
node --test setup/standalone/tests.mjs
node setup/standalone/build.mjs --version 0.1.0
```

The existing source installer is also the dependency/build preparation command;
its home must be a new, isolated build home. On Windows, use a Windows path.
The builder uses Node 24+, packages the current host's Node executable, and
requires the installed source dependency trees. Windows installer builds also
require NSIS (`MAKENSIS` can specify its compiler path). macOS uses `pkgbuild`.
Use `--portable-only` to omit native installer generation, or `--out DIR` to
select a new output directory. Product versions must be `X.Y.Z`, and a release
directory is never overwritten. Update the plugin versions in `setup/manifest.json`
when you deliberately change their source versions.

Packaging resolves `workspace:` dependencies to built source packages and plugin
peers to the matching Harness workspace, rather than accidentally shipping their
development-only Harness versions. Other installed runtime versions are retained.
Package assets follow their files lists, including hidden runtime metadata;
credentials, `.env`, `.npmrc`, Git folders and source maps are excluded. Bundled
plugins are registered in the deployed CLI's installation graph. The Harness
source checkout itself is not modified. There are no runtime links to the
developer's checkout or package store. All packaged directories are real files,
so Windows needs no symlink privileges.

Each build starts an isolated Web server, checks its authenticated HTML response
and every injected JavaScript script, and stops it before archiving. It does not
make model requests. This smoke establishes server startup and asset delivery;
it does not establish every plugin interaction or every external integration.
Local macOS verification also runs a headless browser, checks Strique branding
and Better Sidebar activation, and rejects page errors. This additional check
can be enabled with `STRIQUE_PLAYWRIGHT_MODULE` pointing to a developer-installed
Playwright module and optional `STRIQUE_BROWSER_EXECUTABLE`/`STRIQUE_SCREENSHOT`.
Playwright is a build/test dependency, not included in end-user packages.

`STRIQUE_TEST_NETWORK=1 node --test setup/standalone/tests.mjs` additionally tests
the start/stop endpoint and a complete signed update through a temporary HTTPS
server. The HTTPS fixture needs OpenSSL and uses temporary test certificates;
it never changes the system trust store.

## Install and launch

On macOS, install the `.pkg` and open Applications → Strique. For a portable
archive, extract it and double-click `Install Strique.command`, then
`Launch Strique.command`. On Windows, run the `.exe` and use the Strique
shortcut; a portable archive includes `install.cmd` and `launch.cmd`.
On Linux, extract the archive, run `./install.sh`, and launch Strique from the
application menu or `~/.local/bin/strique`.

The launcher asks the operating system for a free loopback port by default.
It opens the resulting address in the browser and reopens that address on later
launches while Strique is running. This avoids conflicts with another application
on port 3080. For an intentional fixed port, pass `start --port 8080`.
It never terminates an unrelated process to free a port. Use `stop` to shut down
the current Strique server through its authenticated control endpoint.
Windows installations also add a **Stop Strique** Start-menu shortcut. Closing
the browser alone leaves the local server running; clicking Strique again reopens
that existing server instead of launching another instance.

The Windows installer embeds the portable archive instead of recursively
embedding individual runtime files, avoiding NSIS's compiler path-length limit.
It uses its bundled Node runtime and Windows's built-in `tar` to verify and extract
the archive, then installs the verified release. Windows 10/11 with built-in `tar`
is required. Each Windows build also silently installs the actual `.exe` into an
isolated test home and checks the installed Web interface and authenticated stop.
The silent installation test allows 20 minutes on the build runner and reports
elapsed time and the current installation stage every 30 seconds. A timeout stops
the installer process tree and includes the recorded stages in the failure log;
inventory, Web startup, and shutdown checks still have to pass.

Data locations:

| Platform | Application state and user data |
| --- | --- |
| macOS | `~/Library/Application Support/Strique` |
| Windows | `%LOCALAPPDATA%\Strique` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/Strique` |

`releases/<version>` holds replaceable program files. `home/` holds Harness
profiles, settings, sessions and credentials. `logs/web.log` holds private startup
logs, including the authenticated local launch address. Installation never copies
the developer's `.dsh` home. Override `STRIQUE_DATA_DIR` for isolated verification.
Keep the initial application release while it is referenced by your shortcut.
Shortcuts load installation state, so later launches use the activated release.

The bundled controller accepts `start`, `stop`, `status`, `check-update`, `update`,
and `rollback`. Invoke it with the bundled runtime, for example:

```sh
./bin/node ./control.mjs status
./bin/node ./control.mjs stop
./bin/node ./control.mjs update
```

On Windows, replace `./bin/node` with `.\bin\node.exe`. `start` accepts Web
arguments such as `--no-open` and `--port 8080`. Do not override its loopback
binding for public hosting. `stop` authenticates to the launcher's private local
control endpoint and requests shutdown; it does not send a signal to an arbitrary
PID found in a file. Closing the browser alone does not stop the local server.
Immutable release builds disable source/client HMR; configuration changes apply
on restart. Existing extra plugins in the user profile can be managed with the
bundled package manager; bundled plugin versions follow the application release.

## Private GitHub source and automated builds

`platform-release.yml` is a workflow template. Export a fresh source snapshot with
`setup/export-source.mjs`, place that snapshot in a private distribution-build
repository preserving its folder layout. The updated exporter also places the
workflow at `.github/workflows/platform-release.yml`. This repository must contain the sources,
not merely Git submodule pointers or the `setup` folder. Ensure runtime assets and
the memory plugin's bundle patch are tracked. Do not add credentials or installed
dependencies. This snapshot approach leaves the existing independent development
repositories intact; refresh the snapshot when publishing a new product release.

Run the workflow manually with a new product version. Separate runners build and
smoke Windows x64, macOS ARM64/Intel, and Ubuntu x64/ARM64. It installs and builds
each platform's dependencies locally and retains installers/update archives as
private build artifacts. The workflow has not been run on GitHub in this session.
GitHub artifacts are intermediate developer outputs, not your users' download
service. No repository was created and no code or packages were pushed or uploaded.

## Configure signed updates when hosting is available

No hosting address was provided, so the current local release has updates disabled.
There is no fabricated download URL. Set up HTTPS storage or a download service
and then rebuild releases with a pinned public verification key and platform feed.

1. Generate an Ed25519 key pair outside the source/export directories:

   ```sh
   node setup/standalone/create-signing-key.mjs /safe/private.pem /safe/public.pem
   ```

2. Build with the platform's HTTPS metadata URL and public key:

   ```sh
   node setup/standalone/build.mjs --version 0.2.0 --update-url https://YOUR-HOST/darwin-arm64/latest.json --public-key /safe/public.pem
   ```

   For CI, provide `update_base_url` and repository variable
   `STRIQUE_UPDATE_PUBLIC_KEY` containing the PEM public key. The workflow uses
   `<base>/<target>/latest.json`. Private signing keys are never embedded in packages.

3. Sign metadata for the generated portable archive:

   ```sh
   node setup/standalone/publish-feed.mjs /path/strique-0.2.0-darwin-arm64.tar.gz https://YOUR-HOST/darwin-arm64/strique-0.2.0-darwin-arm64.tar.gz /safe/private.pem /path/latest.json
   ```

4. Upload the archive first, then the signed metadata, using your storage service.
   Keep installers and old release archives available. The supplied publisher
   creates metadata locally; it does not send files to a service.

5. Users run `check-update`, then `update` after stopping Strique. The updater
   checks the signature, target, version, exact archive size, SHA-256, safe archive
   paths, and file inventory. It stages the new release, checks fresh configuration,
   and switches the active version only after validation. Failed validation keeps
   the active version. HTTPS redirects cannot downgrade to HTTP. Trust-key rotation
   requires a deliberately planned release; the updater rejects silent key changes.

The initially installed release must already contain its update URL and public
key. A release built before hosting was configured requires a replacement installer
to enroll it into updates. Public HTTPS storage needs no user account. Private
downloads through a product login/license require a separate authorization service;
authenticated downloads and background scheduled update installation are not yet
implemented. Updates are explicitly invoked and never interrupt active sessions.

`rollback` switches application files to the previous verified release; it does
not revert user data or establish that older code can read newer session schemas.
Keep data backups and follow Harness migration rules before a downgrade. This is
not an automatic restore of data written after an update.
