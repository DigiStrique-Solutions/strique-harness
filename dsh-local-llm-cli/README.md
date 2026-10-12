# dsh-local-llm-cli

Codex CLI model provider for DeepSeek Harness, with a TablePlus-style settings panel. Queries run through the installed `codex exec` executable. The plugin uses `codex app-server` only to discover model metadata; it does not use that server for inference.

## Requirements

- Harness `0.2.1-alpha.1`, Node `^22.19.0 || >=24`, and Codex CLI. Verified with Codex `0.159.2` on macOS.
- The executable must be installed on the **Harness host**, not merely on the browser's machine. A container needs its own CLI installation and login.
- A valid Codex login and network access to its model service. OpenAI inference is not offline, even though the executable runs locally.

## Install

From this workspace:

```sh
cd /Users/rishab/Deepseek/dsh-local-llm-cli
pnpm install --ignore-scripts
pnpm run check
pnpm run pack:local
```

The development dependencies link this adjacent Harness checkout. The packed artifact excludes those links; Harness supplies matching runtime peers, and the installer installs Ajv and its format validators.

Use the installed Harness CLI with your intended home and profile:

```sh
DSH_HOME=/path/to/harness-home dsh plugin --profile web add /Users/rishab/Deepseek/dsh-local-llm-cli/dsh-local-llm-cli-0.1.0.tgz --ignore-scripts
```

Restart that profile after its running sessions finish, then refresh the browser. Open **Settings → Local CLI**. Select **Codex CLI** in the conversation model selector to send requests through this plugin. Its provider route is `local-codex-cli`; it does not replace the existing `openai-codex` API provider.

The plugin contributes its own settings page and Codex-only provider navigation. It does not replace Harness's existing Models page or add inactive OpenAI, Anthropic, or Ollama entries. The reference screenshot's default-vendor and assistant-sidebar switches are not reproduced: Harness's existing conversation model selector owns that behavior.

## Settings

| Setting | Behavior |
| --- | --- |
| Status / Version | Classified CLI login method and detected executable version. Credentials and raw login-status output are never returned to the browser. |
| Executable path | Blank searches `PATH`, then known macOS app locations. An explicit value must name an executable file, not a workspace directory. Paths containing spaces work; `~` expands without a shell. Native Windows auto-detection requires `codex.exe`; `.cmd` launchers are not supported. |
| Sign in | Runs `codex login --device-auth`. The panel displays the verification URL and user code; device login must be enabled for the account. Terminal `codex login` is an alternative. |
| Logout | Calls `codex logout` after a separate confirmation in the panel. This affects other clients using the same CLI authentication store. |
| Refresh | Rechecks installation, login, and model catalog. It does not discard an unsaved settings draft. |
| Default model | Used by the `codex-default` alias. Choosing a specific model in a conversation overrides this default. The alias ignores personal CLI model configuration and uses Codex's built-in default when no explicit plugin default is selected. |
| Reasoning effort | Uses CLI-discovered model options where available. A conversation's explicit effort overrides the plugin default. Model-default leaves the CLI's default intact. |
| Workspace directory | Blank runs in a private temporary directory. An explicit existing host directory sets the invocation's working directory; this does not grant native editing permission. |
| Additional model IDs | Makes manually entered IDs selectable even when absent from discovery. Listing a model does not establish account entitlement. |
| Request timeout | Default 300 seconds; cancels the process on expiry. |
| Maximum tool calls | Default 16 per response; exceeding the limit rejects the entire response. |
| Reload settings | Discards the draft and loads the most recently accepted Harness settings. |

Settings use Harness's configuration forms with an atomic revision-checked save. Remote/read-only connections may refuse writes. Harness also rejects writes to entries overridden by a command-line or home patch; install through the profile plugin manager to keep the normal editable configuration path.

Other host configuration fields are `maxPromptBytes` (8 MiB) and `maxOutputBytes` (4 MiB). All configuration fields are volatile and updates apply to subsequent requests; prepared requests retain their captured configuration.

## Query and tool flow

1. Serialize the ordered Harness messages, instruction text, active tool schemas, prior calls, result identities, and error flags into a prompt. The input travels over stdin; prompts never become shell commands or command-line arguments.
2. Start a fresh `codex exec --json --ephemeral` process with a final-response JSON Schema. Each invocation receives the current Harness history; CLI thread resumption is not used.
3. Collect the final structured response. The adapter buffers output and validates the entire envelope before releasing any text or tool calls.
4. Validate every requested tool against the active declarations and its JSON Schema. Unknown names, malformed JSON, invalid arguments, unsupported schemas, and excessive call counts reject the response.
5. Return validated calls to Harness, which owns execution and approvals. Tool results return as history in the next CLI invocation. The plugin does not execute those tools itself.

The final-response envelope has `text` and `toolCalls`; each call contains a `name` and JSON-encoded `arguments` string. Each accepted call gets a fresh correlation ID. Reported token usage splits cached input from uncached input; unavailable counters are not fabricated.

## Restrictions and compatibility limits

- **Text only.** Native image blocks and unprojected file/content blocks fail explicitly. Harness-projected file-handle text can be read as text, but the plugin does not open the referenced file. Native tool update metadata is not advertised; Harness supplies the complete current tool declarations.
- **Buffered output.** Text, calls, and usage appear after the CLI response completes. JSONL events are monitored for failures and native actions, not used to display live reasoning or token deltas.
- **Prompt-based tool bridge.** This is not native API function calling. Validation establishes that calls are declared and arguments conform to supported JSON Schema, not that the model's decision is appropriate. Harness authorization still applies. Draft-07 and 2020-12 schemas and standard Ajv formats are supported; unresolved external references, unknown formats/keywords, and other unsupported dialects fail before inference.
- **Generation settings.** Explicit temperature or nonempty stop sequences fail. `maxTokens` is not enforced by this CLI backend; the UI states this limitation. Byte limits are resource bounds, not model output-token limits.
- **History semantics.** Roles are represented in a serialized prompt; Codex's own instructions and agent behavior remain. They do not match a raw model API's role priority or context handling. Repeated history and Codex's built-in instructions add context and latency overhead. A tiny live test used about 9,800 input tokens, so assume substantial per-invocation overhead.
- **Native execution controls.** Requests ignore personal config and rules, set a read-only sandbox, disable web search, project instruction discovery, shell/unified execution, hooks, connectors, plugins, delegation, memories, goals, image tools, browser tools, sleep, and tool suggestions using CLI controls. Existing stored authentication is retained. System/managed configuration still applies. Native-action JSONL events cause immediate termination and rejection; event detection cannot undo an action that already occurred. These controls are not a guarantee of complete isolation from every tool introduced by future CLI versions.
- **Privacy and attribution.** Temporary schema and response files are removed after completion or cancellation. `--ephemeral` avoids normal rollout persistence, but Codex may maintain its own logs and state database. The subprocess inherits the host environment for existing CLI authentication. OpenAI requests carry Codex's own client identity; the plugin does not directly control the HTTP transport or claim Harness's ordinary provider-header attribution.
- **Authentication and service limits.** Authentication, token refresh, pricing, availability, and rate limits remain owned by Codex and the selected account. No credential files are parsed or copied by the plugin. Catalog discovery is advisory; successful inference is the access check.
- **Platform/version scope.** Tested on macOS with CLI `0.159.2` and Harness `0.2.1-alpha.1`. Other versions and Windows/Linux are unverified. Missing binaries, unavailable models, failed turns, unsupported flags, and process crashes return explicit failures. POSIX cancellation terminates the process group; Windows cancellation terminates the direct child.
- **Trusted host integration.** The settings API sits on Harness's authenticated, same-origin `/api` carrier. The configured executable is trusted host code. This plugin is intended for personal/trusted Harness installations, not an untrusted public service or shared credential broker.

## Verification

```sh
pnpm run check
```

The keyless suite tests real child processes and real Cordis/Harness LLM registration using a deterministic CLI fixture. It covers text, tool calls, invalid arguments, native-action rejection, malformed/incomplete output, cancellation, timeout, unload, bounded output, device login cancellation, model pagination, and privacy of status output.

`test/browser-smoke.mjs` exercises an isolated Harness web profile. Supply `DSH_CLI_QA_DIR` containing its protected `launch-url` file and a Playwright installation (`PLAYWRIGHT_MODULE` optionally points to its ESM entry; `PLAYWRIGHT_EXECUTABLE` optionally names a browser). The test changes only that isolated profile. It checks panel activation, actual CLI status/catalog, model-default persistence, refresh, reload, narrow layout, and page errors. Never use a production profile for this test.

Live verification on 2026-10-05 also confirmed a text response and a two-invocation tool round trip through the actual installed CLI using the existing ChatGPT login. It did not sign out, reauthenticate, or modify the user's active Harness profile.

## Official documentation

- [Non-interactive mode, JSONL events, schemas, and ephemeral requests](https://learn.chatgpt.com/docs/non-interactive-mode)
- [CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Authentication](https://learn.chatgpt.com/docs/auth)
- [App-server model discovery and protocol](https://learn.chatgpt.com/docs/app-server)
- [Configuration controls](https://learn.chatgpt.com/docs/config-file/config-reference)

## Remove

```sh
DSH_HOME=/path/to/harness-home dsh plugin --profile web remove dsh-local-llm-cli
```

Restart the profile and refresh the browser. Unloading cancels active CLI processes and removes the provider, route, styles, and settings contribution.
