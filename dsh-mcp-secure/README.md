# Strique DSH MCP Client

Compatibility (0.9.3): Tested with Harness `0.2.1-alpha.4`, Cordis `4.0.5-alpha.2`, and Schemastery `3.18.5-alpha.2`. `engines.dsh` pins this release to the tested Harness version; other versions require separate verification.

A security fork of `hyqhyq3/dsh-mcp-manager` 0.6.0 (commit `69d5cbc76e21606867f6dbef05025e2e2dfdbd04`). This repository is maintained by DigiStrique Solutions. The installable package remains `dsh-mcp-manager-secure`, with its own state directory, to preserve compatibility with existing installations. It is not published to npm.

Manage HTTP and local stdio MCP servers under **Settings > MCP (Secure)**. HTTP supports unauthenticated endpoints, custom headers, environment-backed bearer tokens, and SDK-managed OAuth with PKCE. Providers must implement a compatible MCP transport and authentication flow; an arbitrary URL alone is not sufficient.

## Tool permissions

Open a server's **Tool permissions** to select **Always allow**, **Ask each time**, or **Block** for each tool. Search tools or apply a setting to all displayed tools. New tools default to Ask, including tools that advertise themselves as read-only. Permissions persist across reconnects and disable/enable; changing the server configuration, tool schemas, or execution annotations resets affected tools to Ask. Description and title changes preserve the saved choice, including documentation nested inside input/output schemas. Stale settings cannot overwrite a changed definition. The server list and permission rows identify tools that require renewed review. Explicitly saving a permission clears that notice. During upgrade, legacy records migrate only when their complete saved definition still matches; existing Ask choices stay Ask.

Ask uses the Harness approval interface and its session audit log. Review the tool's arguments in the conversation and choose Allow once or Reject. Missing answerers, headless calls, cancelled calls, timeout, or changed permissions deny execution. `approvalTimeoutMs` defaults to five minutes. Always allow skips this manager's prompt but remains subject to other Harness policies. Harness Full access disables approval prompts; a tool still set to Ask is rejected with instructions to review its permission or enable prompts. Block is enforced before MCP transport dispatch, including discovery-helper calls. Approval applies only to that execution; it does not change the saved permission.

## Compatibility

The current development branch targets DeepSeek Harness `0.2.0-rc.2`, Cordis `4.0.4`, MCP SDK `1.29.0`. Requires the Harness `tools`, `webServer`, `connection`, and `agents` services. Node's supported engine range follows Harness; the verification report records the actual platform and Node version tested. Older Harness versions without `connection.requestRejection()` cannot activate this plugin.

## Install a reviewed local artifact

From this repository:

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm check
pnpm test
mkdir -p artifacts
pnpm pack --pack-destination artifacts
```

Then use an isolated Harness home first:

```sh
DSH_HOME=/absolute/path/to/test-home dsh plugin --profile web add /absolute/path/to/dsh-mcp-manager-secure-0.9.2.tgz --ignore-scripts
DSH_HOME=/absolute/path/to/test-home dsh --profile web --dump-config
DSH_HOME=/absolute/path/to/test-home dsh --profile web --port 3198
```

Do not run the original manager alongside this fork: both own `/mcp-manager` routes and `mcp__...` tool names. Remove the original package from a profile before switching. No old configuration or tokens are imported automatically. Recreate and review server definitions in the authenticated UI.

## Configuration and approval

Global servers are scoped to the current profile. Workspace proposals live in `.dsh/dshmm/mcp.json`:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://example.com/mcp",
      "authMode": "static",
      "headerEnv": { "Authorization": "EXAMPLE_AUTHORIZATION" }
    }
  },
  "exclude": []
}
```

`authMode: "static"` allows no auth, custom headers, or `tokenEnv`, whose environment variable contains the bearer token without the `Bearer ` prefix. `headerEnv` maps header names to environment variable names and sends the environment value unchanged. `headers` contains literal secret values. A local server uses `type: "stdio"`, `command`, a string array `args`, optional absolute `cwd`, and string-valued `env`.

Workspace files cannot start servers until an authenticated user reviews and approves the exact normalized definition. Editing a file invalidates that approval. Saving a workspace definition through the authenticated UI approves the saved definition. Commands retain operating system account permissions; environment filtering is not sandboxing. Review commands, package versions, arguments, working directories and environment values before approving them.

OAuth tokens are bound to the complete MCP endpoint URL and discarded when its binding or workspace approval changes. OAuth uses dynamic registration by default. For a pre-registered public client with PKCE, set `oauthClientIds` in the Host plugin configuration, mapping the global server's ID to your provider App ID. Client secrets are not supported by this option. Changing the configured client discards its previous OAuth credentials and resets tool permissions. On return from an external provider, click **Continue authorization** if shown. This establishes a same-origin navigation before exchanging the code with Harness's Strict session cookie.

Meta Ads compatibility: on September 9, 2026, `https://mcp.facebook.com/ads` was reachable but its registration endpoint rejected this manager with `invalid_client_metadata`. Configuring your own registered App ID bypasses that registration step. The app must have Meta's MCP use case, required permissions and the exact callback registered. A public URL alone does not establish this. No Meta account access or ad operations were tested.

For an HTTPS reverse proxy such as ngrok, set `publicOrigin` to its exact HTTPS origin and add its exact hostname to Harness Connection's `trustedHosts`. Start authentication from that HTTPS app URL. The callback is `<publicOrigin>/mcp-manager/callback/<server-id>`. Forwarded headers cannot choose the callback origin, and all management routes still require Harness authentication. Disable tunnel request inspection to avoid recording OAuth codes and session cookies. The local HTTP app remains usable.

Settings views expose configured secret keys, not their values. Unchanged secrets survive edits; changing a key clears its previous value. Prefer environment references. URLs and command arguments are displayed and should not contain credentials.

## State and lifecycle

State is stored in `$DSH_HOME/mcp-manager-secure/<profile-hash>/state.json`, or `~/.dsh/...` if `DSH_HOME` is unset. The profile hash comes from the root configuration URL. Directory mode is `0700`, files `0600`; writes replace files atomically and a process lock prevents simultaneous writers. An absolute `stateDir` override is available for embedding.

The bundle row accepts these runtime options:

| Option | Default |
| --- | --- |
| `stateDir` | Active home plus profile hash |
| `publicOrigin` | Unset; explicit HTTPS origin for a trusted reverse proxy |
| `oauthClientIds` | `{}`; global server IDs mapped to pre-registered public client IDs |
| `maxBodyBytes` | 262144 |
| `maxResponseBytes` | 8388608 |
| `maxTools` | 1000 |
| `requestTimeoutMs` | 60000 |
| `reconnectDelayMs` | 1000 |
| `reconnectMaxAttempts` | 5 |
| `oauthTimeoutMs` | 600000 |

Tool results retain structured data and content blocks, including when invoked through the on-demand broker. Non-text media is retained in the canonical result but rendered as a text notice, not downloaded or embedded. Tools use exclusive scheduling. Cancellation reaches the MCP request and HTTP connection; stdio servers receive cancellation notifications. Disable, edit, removal and unload cancel connections and withdraw tools. Existing agent scopes are restored after plugin reload. Reconnects have a finite retry budget. Tool calls are never replayed automatically.

## Remove and rollback

```sh
dsh plugin --profile web remove dsh-mcp-manager-secure
```

Package add, remove and update change the bundle set for the next profile start. Restart the profile to apply them. Removal then withdraws the bundle and tools but retains private state for deliberate reinstall. To reset configuration, remove the corresponding state directory only after the profile is stopped and after preserving any needed configuration. Reinstall the reviewed tarball to restore this version. Returning to the original package also returns its audited vulnerabilities; the two state formats are intentionally separate.

See [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), and the repository's `docs/verification.md` for evidence and limitations. Real Meta Ads account operations are outside the local test suite. The current Harness settings shell clips its content at phone widths; this fork is verified for desktop use.
