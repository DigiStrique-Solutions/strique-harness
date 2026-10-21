# DigiStrique Skills Manager

Compatibility (0.4.4): Tested with Harness `0.2.1-rc.2`, Cordis `4.0.5`, and Schemastery `3.18.5`. `engines.dsh` pins this release to the tested Harness version; other versions require separate verification.

`dsh-skills-manager-secure@0.4.2` is an independently maintained DigiStrique Solutions
plugin. It has its own source repository, build, tests and release lifecycle. It does
not install or call the original skills-manager plugin. The package is private,
retains the `UNLICENSED` designation and is not published to npm.

The initial source came from
[Xichun123/dsh-skills-manager](https://github.com/Xichun123/dsh-skills-manager)
at `62ea71afea1375d26463404c1a09a62b9cd11ad0` (0.1.11). This attribution records
source provenance; updates and operation do not depend on that repository.

Open **Settings > Skills** to inspect the resolved inventory for an explicit
conversation or workspace and preset. **All skills** includes external sources,
blocked winning definitions, plus shadowed and inactive imported copies. External providers expose only winners through the upstream API. **Sources & access**
shows observable source identities and plugin access rules. **Imported copies** retains the existing
review, install, update and remove workflow. A conversation's **Context** button
separates current summaries, full instruction loads and recorded tool schemas.
Plugin labels are English; source instructions are not automatically translated.

## Requirements

- Official, unmodified **0.2.1-rc.2** Harness packages, Cordis 4.0.5, React 18. No core fork, vendored implementation, or core package override is needed. Compatibility with other prereleases must be verified before upgrading.
- Node 22.19 or newer, Git, and **Python 3** with POSIX directory descriptor support.
- macOS is tested. Windows is not supported by the snapshot/process implementation.
- A direct authenticated `localhost`, `127.0.0.1`, or `[::1]` connection is required
  to inspect sources, import, update, remove, or change activation. Authenticated
  remote connections can view the catalog. Forwarded/proxied mutations are denied.
- Workspace scopes must be registered in Harness.

## Build and test

```sh
git clone https://github.com/DigiStrique-Solutions/dsh-skills-manager-secure.git
cd dsh-skills-manager-secure
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm pack --pack-destination artifacts
```

Development dependencies resolve official npm registry artifacts. See [verification](VERIFICATION.md) for evidence and limits. No install/prepare scripts run automatically; builds are explicit.

The bundle mounts access, runtime and manager rows. The runtime owns scoped skill tools and filters upstream catalog/manual injections through the supported pre-step hook, so standard preset skill tools cannot bypass plugin rules. It waits for complete discovery before the first model request and loads full instructions on demand. Missing or corrupt policy blocks dispatch/loading while the runtime is installed.

When upgrading from 0.3.x, remove the obsolete profile `skill.config.requiredPolicies` entry and all patched `@deepseek-ai/dsh-*` tarball dependencies/overrides as part of the verified switch to official packages. Back up the profile, policy directory and retained library first. Old nonempty access rules require explicit review because the public upstream API exposes different source identities; loading remains blocked until reviewed. The review explains that it replaces prior scoped rules with the listed global choices. Reapply workspace/preset restrictions before resuming use.

Removing the whole plugin restores upstream behavior. It does not leave a core enforcement guard behind. Other plugins calling `ctx.skills.get()` directly are outside this plugin's policy boundary. To disable skill access, keep the plugin installed and set sources Off.

Install the built tarball with the Harness CLI:

```sh
dsh plugin --profile web add /absolute/path/dsh-skills-manager-secure-0.4.2.tgz --ignore-scripts
```

Remove the upstream package from that profile before activating the fork to avoid
two managers being presented to users. Bundle membership changes require a Harness
restart. This fork mounts its authenticated route through its own `webServer`
dependency and needs no patch to Connection's injection list.

## Access and context

Policy is stored separately under `$DSH_HOME/skills-access/policy.json`, with a
persistent initialization marker, atomic writes, a cross-process lock and revision
checks. Missing or corrupt committed state denies access. Never delete this directory
to reset permissions. Rules record a local action and timestamp, not a user identity
or historical consent inferred from file timestamps.

Existing discovery is preserved until the explicit shared-source review is applied.
The review supports Off, Manual or Automatic. After review, new shared-personal
sources require admission. Global source Off is a ceiling. Within an admitted
source, explicit skill rules override its default; workspace and preset restrictions
combine restrictively. Declared user/model invocation limits always apply. Controls
show the effective access for the selected view, so a wider rule may remain limited
by another scope. A source approval follows provider and origin, not the display name.

These rules control this plugin’s catalogs, skill tool and explicit invocations. They do not govern unrelated plugins calling the upstream registry directly. They do not revoke CLI or MCP
credentials, restrict ordinary filesystem reads, cancel running tools or erase
instructions already retained in conversations. Administrative previews can show
blocked instructions without adding them to model context. External skills have
access controls, not a misleading uninstall action.

Context uses a single observed Session log cut and the core's current-surface fold.
Counts distinguish unique skills from repeated instruction loads. Compacted or
replaced loads remain historical. Known source/version metadata on new loads is
retained; missing historical attribution is shown as unavailable. Resource reads
through arbitrary files or shell commands cannot be reliably attributed. Text token
estimates use characters divided by four and are explicitly approximate. Recorded
provider usage is shown separately when present.

The request view reconstructs prepared headers and settled attempts, not an exact
adapter wire payload. Tool provider attribution is unavailable in the recorded
headers; no MCP/plugin identity is guessed from a name. Existing Settings navigation
manages plugins and MCPs. This pinned shell exposes no section-to-section navigation
API, so the plugin gives navigation guidance without manipulating shell DOM.

## Storage and behavior

The default library is `$DSH_HOME/skills-manager-secure`, separate from upstream's
`skill-manager` directory. Existing upstream data is preserved and is not migrated
or silently enabled. Import desired sources explicitly; new imports start disabled.
An absolute `storageDir` may be configured on the `dsh-skills-manager-secure` row.
Do not point it at upstream storage.

The retained library defaults to 256 MiB and 65536 entries. Configure a positive
integer `maxStorageBytes` on the plugin row to change the byte limit. New imports
and updates fail before publication when the limit would be exceeded; existing
versions are preserved.

One atomic `state.json` contains enablement, invocation overrides, and source/object
records. Immutable object folders contain the installed bytes. A directory lock
serializes commits across profiles and processes; each writer rereads state under
that lock. Failed commits do not alter the active library. Published objects remain available after updates and removals so active and saved
conversations retain their resource paths. They are never automatically collected. Registry caches are invalidated
when another process changes state, normally within 200 milliseconds.

Each new object contains the complete validated source layout, with each skill
pointing at its original subdirectory. Shared resources inside the chosen source
root work. Select the repository root when skills reference sibling directories.
Paths outside that root are not bundled, and arbitrary script dependencies cannot
be inferred from Markdown. Update checks hash the entire snapshot, including empty
directories; changes elsewhere in the same source may therefore offer an update.

Inspect reads structured YAML and returns a snapshot hash. Import checks that hash,
validates exact selections, then publishes only bytes copied into a private staging
directory. Changes since inspection require a new inspection. Name collisions are
rejected. Invalid and duplicate entries are shown individually in the import review;
valid named selections can still be imported. An implicit import of all entries
rejects if any diagnostics exist. Updates may only use the original source and relative skill path. To replace
an origin, remove the old entry and import the replacement, which starts disabled.
Manual invocation choices persist across source updates, including a choice matching
the previous frontmatter declaration.

Git inputs accept `owner/repo`, HTTPS URLs, and local `file:///` repositories.
Append `#branch-or-tag` to pin a named ref. Credentials, query parameters, SSH,
HTTP, remote helpers, and submodule traversal are not supported. Private repositories
can be cloned by the user and imported as a local folder. Nonempty `.gitmodules`
files and unresolved Git LFS pointers are rejected with export instructions.
Export materialized assets as ordinary files and remove submodule metadata before
importing; the manager does not fetch those dependencies automatically.

Each operation permits at most 256 skills, 4096 entries, 16 directory levels,
4 MiB per resource file, 256 KiB per SKILL.md, and 32 MiB total snapshot bytes.
`.git`, `node_modules`, and `__pycache__` are excluded. Symlinks and special files
are rejected. Git working directories are monitored against a 64 MiB/8192-entry
budget while fetching; this is a polling limit, not an OS disk quota. At most two
source operations run concurrently per manager. Requests and child processes have
bounded lifetimes. Disposal cancels and awaits in-flight work and removes routes,
providers, file observers, styles, and Client requests.

## Known display limitation

The upstream Harness Settings shell clips content at phone widths (390 pixels),
including its built-in General page with this fork removed. Desktop widths are
verified; phone use is not claimed as supported. This fork does not patch the
Harness shell or its DOM.

## Recovery and rollback

The atomic rename of state.json is the commit point. Cancellation before this point
leaves the previous state active; disconnecting after a commit does not undo it.
This is atomic application publication, not a power-loss-safe filesystem transaction.

After a process crash, verify no manager process is writing this storage before
removing a stale `.mutation-lock` directory. Its `owner.json` records the PID. The
lock is never stolen on a time heuristic. Abandoned staging/object folders can be
removed while all users of this storage are stopped; preserve objects referenced by
state.json AND every object referenced by saved conversations. Absence from the
current manifest does not mean a published version is disposable. Archive or discard
the affected conversations before explicitly deleting their resource versions.
Normal operation cleans staging and failed-publication objects. A failed cleanup
does not report a committed operation as failed: it produces a Host maintenance
warning and retries before the next mutation, checking directory identity before
removing a retained lock. Persistent permission failures or a process crash may
still require the manual recovery above.

Version 0.2.1 reads existing 0.2.0 subtree objects without relocating them. Update
checks offer an explicit layout upgrade; updating preserves enablement and retains
the original object. Back up the profile AND the entire private library before
upgrading. A rollback to 0.2.0 must restore that library backup, because 0.2.0 cannot
interpret the new source-layout objects.

To roll back, remove this package from the profile and restore the previous upstream
package/profile backup. Both libraries remain separate. Plugin removal does not erase
your library. No cloud publishing or live-server restart is performed by the test suite.

## Context and bulk updates

Measured input includes uncached, cache-read and cache-write tokens. The latest catalog defines current availability; retained instruction loads remain historical evidence. Refresh responses are bound to the selected conversation and request generation. Previews compare the selected definition, the loaded definition and a fresh winner snapshot. A mismatch withholds instructions and requires a retry. Upstream provides no immutable revision token for external providers, so same-metadata external content edits are not claimed to be detectable.

Update all uses `update-many` to snapshot each source/ref once, validate the selected group, and publish that group atomically. Equivalent currently installed snapshots are reused without another storage charge. Independent source failures are reported separately; completed groups remain committed. Historical snapshots remain readable and count toward quota.
