# Plugin-only skills architecture, 0.4.1

Official Harness 0.1.7-rc.2 is the unchanged base. This bundle owns three Host rows: `dsh-skills-access` for persistent policy and inspection, `dsh-skills-runtime` for scoped model/user entry points, and `dsh-skills-manager-secure` for retained imports and authenticated browser RPC. The Client uses supported Settings and conversation Slots.

The runtime registers a tool in each agent scope using public `createScope`, so it shadows preset skill tools without modifying them. Its outer `agent/pre-step` middleware waits for complete discovery and replaces competing skill catalog/manual messages in that decision with policy-filtered messages. Historical messages are retained. Required skill services are injected, while policy availability is checked at use time so its withdrawal cannot reveal an upstream tool bypass. Registrations and pending work belong to the plugin and agent lifetimes.

Summaries reach the first model request of parents and children. Full instructions appear only after a tool load or explicit user invocation. The agent object already exists at this boundary; this is a before-first-request guarantee, not a before-agent-construction claim.

The public registry remains available to other plugins, outside these access rules. External sources expose winning definitions and no immutable revision or watcher diagnostics. Imported copies retain exact source/version metadata. Preview reads compare public metadata before, during and after loading and withhold mismatches.

Source Off is a ceiling. Skill rules override admitted source defaults while workspace/preset restrictions combine restrictively. Source-identity upgrades require explicit review of old nonempty rules. Uninstall restores upstream behavior; it is not a revocation operation.

`source.ts` and `snapshot.py` validate and snapshot source bytes. `storage.ts` owns atomic locked publication and retained resources. Updates share one object per source snapshot. `access-service.ts` resolves views and policy; `runtime.ts` owns model-visible behavior; `http.ts` authenticates bounded local operations. The browser never scans files or handles authority itself.

Langfuse stays an independent observability plugin. It captures prepared requests via public LLM middleware and the telemetry redaction waterfall. No private core package or API is required by either plugin.
