# Meta Ads OAuth compatibility diagnosis

Updated September 9, 2026. No changes to plugin security controls or production profiles were made for this investigation.

## Direct evidence

- Our machine reaches the MCP endpoint and receives its OAuth challenge. Both metadata documents return HTTP 200.
- Meta advertises a registration endpoint and S256 PKCE, but does not advertise Client ID Metadata Document support.
- Our registration request is rejected with HTTP 400, `invalid_client_metadata`, and `Dynamic registration is not available for this client.` Adding `application_type: native` does not change the result.
- The user demonstrated Claude selecting automatic registration and reaching Facebook login. Its authorization URL identifies client `4510005499318155` and redirect `https://claude.ai/api/mcp/auth_callback`. The user's transient state and PKCE challenge are intentionally omitted here.

## Corroborating provider-integration evidence

A [firsthand report in Cursor's forum](https://forum.cursor.com/t/official-meta-ads-mcp-oauth-fails-dynamic-registration-is-not-available-for-this-client/167650) records the same client ID for accepted Claude callbacks, while local and Cursor callbacks fail. An [August 7 support reply](https://forum.cursor.com/t/official-meta-ads-mcp-oauth-fails-dynamic-registration-is-not-available-for-this-client/167650/6) attributes the failure to Meta's redirect allowlist and says static credentials require a Meta-issued client covering Cursor's redirects. This is support-side corroboration, not access to Meta's internal implementation.

Together, the user's working Claude flow, our direct rejection, and that report strongly support a client/callback registration restriction. The local network itself is working. Exposing Harness at an arbitrary public HTTPS URL would not establish acceptance by Meta. DCR being advertised does not mean arbitrary client callbacks are permitted.

Our manager already supports the DCR and Streamable HTTP methods selected in Claude. The rejection above concerns automatic registration of our client. It does not establish that developers cannot register and use their own Meta app. Copying Claude's client ID cannot establish our callback as registered, and its existing authorization flow returns to Claude with PKCE state owned by that client.

## Verified alternative: the user's existing Meta app

After the user mentioned their approved developer app, Meta's own [July 16 developer announcement](https://developers.facebook.com/blog/post/2026/07/16/meta-ads-mcp-server/) and [getting-started documentation](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started) were fetched directly and read. They explicitly support reusing an existing app, adding the **Create & manage ads with ads MCP server** use case, and supplying its App ID as the OAuth client ID. The callback must be configured for that MCP client in Facebook Login for Business settings. Meta also documents a user access token option.

Meta requires Advanced Access to `ads_mcp_management` and app review when managing other businesses' data. Approval for existing Marketing API permissions does not establish approval for this new permission. The user's app settings, permission access and callback acceptance have not yet been inspected.

The manager currently supplies only dynamically registered client information. Supporting a user-supplied, pre-registered App ID is therefore a concrete missing capability for this documented path and would bypass the failing dynamic registration step. End-to-end success still requires the app's MCP use case, permissions, registered callback and successful consent/code exchange. Whether Meta accepts this preview's exact loopback callback remains unverified. The earlier interpretation of the DCR rejection as requiring a special provider partnership was too broad.

The actual Meta consent, code exchange, account access and tool execution remain unverified in our manager. No consent URL was opened, authorization code exchanged, or ad account accessed during this diagnosis.
