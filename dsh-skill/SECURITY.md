# Security boundaries and audit fixes

This private fork addresses the original regression cases and the follow-up findings
in the 2026-09-09 audit. Coverage is evidence for those cases, not a claim of absolute
security. Version 0.2.1 adds post-commit cleanup fault coverage, snapshot layout and
retention checks, safe name membership and import diagnostics.

| Finding | Change | Regression coverage |
| --- | --- | --- |
| F1, metadata becomes CLI flags | Removed skills CLI; parse YAML, validate kebab-case and exact selection membership | Description `--global`, malicious/empty/duplicate selections |
| F2, different bytes installed after validation | Descriptor-relative no-follow snapshot; inspect digest checked; copy only staged bytes; one Git fetch per operation | Swapped source after snapshot, symlinks, modified inspection |
| F3, activated source overwritten by collision | Reject collisions and changed update origins; replacements require removal and start disabled | Enabled original preserved; explicit replacement disabled |
| F4, local-only policy bypass | Host checks auth, peer/Host/proxy facts and registered workspace; UI follows server capability | Real HTTP auth, remote mutation denial, scope rejection |
| F5, cancellation ignored | Request/lifetime signals through queues/processes; kill process groups and await cleanup | Pre-abort, queued abort, child/descendant termination, disposal |
| F6, multi-instance lost updates | Cross-process lock, fresh state reads, file observer invalidation | Concurrent instances and separate Node processes |
| F7, failed write changes runtime | Atomic manifest references immutable objects; no speculative in-memory state | Injected persistence failure across enable/invocation/remove/update |
| F8, direct-folder update hash wrong | Store exact source-relative folder and complete source snapshot hash | Direct path current/changed/deleted, nested folders, shared assets and Git |

The trusted administrator and other processes running as that OS user can change
plugin code, configuration, or storage. This is not a sandbox against that user.
Python's descriptor-relative source reader prevents untrusted source links or
ancestor replacement from redirecting reads outside the selected directory. Source
scripts are copied as data, never run by the installer. Later invocation of an enabled
skill remains subject to Harness's normal tools and approval policy.

Child environments contain a PATH and a small Git/Python configuration allowlist.
Credentials, HOME, NODE_OPTIONS, and arbitrary parent environment variables are not
forwarded. Git errors are generic; snapshot errors do not echo filenames or content.
The manager performs no telemetry. Network access is limited to requested Git fetches;
this does not provide a network sandbox or Git-server trust guarantee.

Limits reduce accidental/untrusted resource exhaustion. A Git fetch can transiently
exceed its polling budget. The library and process account require ordinary host disk
and resource management. The same user must keep the private storage hierarchy trusted.


## Access enforcement in 0.4.0

The plugin owns policy evaluation, agent-scoped skill tools and pre-step catalog/manual injection. All use supported upstream extension points. It neither modifies the registry nor controls unrelated direct registry or filesystem reads. Missing/corrupt policy blocks new requests and loads while the runtime remains installed. Removing the entire plugin restores upstream behavior, so uninstall is not an access revocation operation.

A policy initialization marker prevents deletion of committed state from silently returning to initial discovery behavior. Source identities from the rejected core extension cannot be assumed equivalent to public upstream identities. Old nonempty policies block loading pending explicit review, which replaces previous scoped rules and requires reapplying restrictions. The UI explains this before confirmation.

New administrative routes require authentication and direct loopback transport,
including forwarded-header rejection. They resolve registered workspaces and recorded
conversation presets, reject stale policy revisions and bind migration to a reviewed
source snapshot. Request and plugin-lifetime cancellation bound operations. Policy
files are no-follow regular files limited to 1 MiB and 4096 rules; responses are
limited to 4 MiB and instruction previews to 256 KiB. Context inspection is limited
to 200000 events. These bounds do not sandbox a malicious same-process provider.

Administrative preview deliberately bypasses skill invocation permission so a user
can review an Off skill. It is never registered as a model tool and never injects a
Session message. Shared source contents and Codex settings are not modified. Source
files remain under their owner's control; approving a source is not a content-signing
or immutable filesystem guarantee. Policy controls do not revoke OS, CLI or MCP access.

Batch updates use the same authenticated direct-loopback and mutation-lock boundaries as individual updates. A selected source group commits only after every selected skill passes validation. Preview loading compares public definition metadata and plugin-owned source identity before returning instructions. External providers expose no immutable revision token; concurrent edits preserving identical metadata cannot be detected.
