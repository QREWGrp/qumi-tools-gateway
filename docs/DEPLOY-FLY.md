# Deploy the Gateway as an isolated Fly.io app

This is a deliberate separate Fly application, not part of the QUMI production deployment.

## One-time deployment

1. Install and authorize the official Fly CLI on your own machine: `fly auth login`.
2. Choose an available Fly app name under your authorized organization: `fly apps create <your-unique-app-name>`. Update `app = "..."` in `fly.toml` to match. The example `qumi-tools-gateway` is **not** proof that this name is available or an application is running.
3. Check the `primary_region`, `Dockerfile`, release digest and concurrency settings. Deploy with `fly deploy -a <your-unique-app-name>`.
4. Confirm `https://<your-unique-app-name>.fly.dev/healthz`, then run the MCP handshake and five-sessions/IP limit test against the deployed service using **synthetic credentials only**.
5. Add the verified `https://<your-unique-app-name>.fly.dev/mcp` URL as a custom MCP server in your ChatGPT workspace if your client supports unauthenticated Streamable HTTP MCP.

The Fly app **must stay at a single Machine** until distributed rate limiting and session affinity are introduced. Keep HTTP service on the Fly proxy only. `TRUST_FLY_PROXY=1` trusts Fly's overwritten `Fly-Client-IP` header; do not expose the underlying Node server directly with this setting. On Fly, TLS is terminated by Fly and `force_https = true` applies.

No secrets are necessary for basic tool discovery. API tokens are supplied only through each user-initiated one-time HTTPS question. No database, S3, persistent volume, OAuth client secret or shared provider token is needed.

## Operational verification

- Initialize six independent MCP sessions from the same real source IP. Expect 200 for the first five, **429** for the sixth.
- Call `DELETE /mcp` for one session ID. Expect **204**. A repeated call using that ID must return **404**. Opening a sixth/new session should now succeed.
- Confirm **429** and `Retry-After` after more than the configured requests/minute/IP.
- Provision a synthetic token via an encrypted question; ensure no token appears in MCP results or logs. End session and confirm its credential question is invalid.
- Validate npm `cli_help` and a harmless read; test Depot help/limited read only after the official pinned Depot image successfully builds.

`fly logs -a <your-unique-app-name>` may be used to inspect runtime health; this source does not emit provider credentials. Do not enable verbose CLI output or log request bodies in an upstream proxy.

## Known limitations

This release is **anonymous, read-only, and single-instance**. It does not support npm install/publish, Depot builds, arbitrary shell commands, or a shared cloud vault. Full mutating operations require a different authorized execution design. No guaranteed automatic session revocation when a browser tab closes: clients should explicitly terminate MCP sessions; idle timeout provides fallback. The gateway has no durable audit log; stdout/stderr and platform request logs are operational-only, not a signed compliance ledger.
