# Migration guide — Local bridges to a hosted HTTPS MCP gateway

This guide is for engineers moving from the four local plugins in [QREWGrp/qumi-tools](https://github.com/QREWGrp/qumi-tools) to [QREWGrp/qumi-tools-gateway](https://github.com/QREWGrp/qumi-tools-gateway), or upgrading an earlier deployment of this gateway.

**This is not an in-place replacement for all local capabilities.** The publicly connectable gateway is deliberately **read-only** and offers a small allowlisted set of npm and Depot operations. Full local CLI access, IONOS domain modifications, Fly deployments, arbitrary package install/build scripts, and npm publishing still require an appropriately authorized agent environment or separately reviewed services.

## Feature mapping

| Before | Hosted gateway | Action |
|---|---|---|
| Local MCP `stdio` (Node process in Codex/Claude/Desktop) | Streamable HTTP at `https://<your-host>/mcp` | Configure a new HTTP MCP connection in a client that supports it |
| Depot Bridge CLI/SDK operations | Restricted `cli_help` and read-only Depot calls | Keep local Depot Bridge for writes and unsupported SDK operations |
| NPM Bridge full CLI | Allowlisted npm help, ping, view, search and authenticated whoami | Keep local NPM Bridge for scripts/install/publish |
| IONOS Bridge | Not included in initial hosted gateway | Use official IONOS MCP or a separately reviewed gateway adapter |
| Fly.io Bridge | Not included in initial hosted gateway | Use official Fly remote MCP where supported |
| Agent's optional encrypted local vault | **No database or persistent gateway vault** | Do **not** migrate or upload the vault file or passphrase |
| Personal `VAULT_PASSPHRASE` | Not requested by the gateway | Leave it in the user's agent vault; supply a provider token only in the protected session form |
| Persistent token or local environment variable | HTTPS one-time credential question; process-memory session only | Enter/auto-fill the token in the question, not chat or MCP arguments |
| Agent-specific user identity | Anonymous random session capability, bound to source IP | Understand this is **not** individual identity verification |
| Local agent restart | Session expiry/explicit revocation | Create a fresh remote MCP session after restart |

## Step 1 — Move the source, not the secrets

Clone/fork the public source and install Node.js 22+. Keep `.env`, `.npmrc`, private tokens, private vault files, customer endpoint lists, and `VAULT_PASSPHRASE` outside the repository.

```bash
git clone https://github.com/QREWGrp/qumi-tools-gateway.git
cd qumi-tools-gateway
npm test
npm run check
```

See [local self-hosting](SELF-HOST.md) or [Fly.io deployment](DEPLOY-FLY.md).

## Step 2 — Verify the installed runtime and protocol

Confirm that the source root contains `Dockerfile`, `fly.toml`, `package.json`, and `src/server.js`. If Fly reports "Could not find a Dockerfile," verify the selected branch and build context. Do not try to deploy the README-only `main` from before the application PR was merged.

After deployment, verify `GET /healthz` and perform a real MCP `initialize` / `tools/list` handshake. This code supports the specified **session-based** MCP versions and returns `MCP-Session-Id`; if your client only supports stateless `2026-07-28`, an adapter or later release is required. Do not pretend an unsupported client is connected.

## Step 3 — Move tool workflows gradually

Switch compatible read-only workflows first. Ask the agent to call `gateway_status`, `cli_catalog`, and `cli_help` without a token. For authenticated operations, call `credential_begin`, open the temporary HTTPS URL, and provide the token through the secure form. The personal password manager or connected agent secrets vault may help fill the form, but the gateway cannot retrieve vault contents silently.

Use `credential_forget`, `session_end`, or HTTP `DELETE /mcp` to terminate access; expiry is a fallback. Gateway revocation removes its stored in-memory session copy **but does not revoke the underlying Depot/npm token at the provider**.

## Operations and rollback

- Keep the existing local plugins installed until the desired operation works through the hosted gateway.
- Before changing a public gateway deployment, verify the Docker image builds and test five concurrent sessions/IP, a sixth HTTP `429`, and successful slot release on `DELETE`.
- The first release is **single-instance**. A second Fly Machine creates an independent in-memory session store and makes five/IP apply *per instance*. Do not scale horizontally without shared limits.
- To roll back: deploy the previous verified image/source revision with one Machine and reconnect clients. All gateway sessions are intentionally lost on restart or replacement.
- Do not expose an HTTP-only endpoint publicly. Fly terminates TLS; non-Fly hosts must supply their own reverse-proxy TLS and trusted client-IP handling.

## Compatibility checklist

- [ ] Exact source revision reviewed and tests run
- [ ] Dockerfile and runtime at deployment root
- [ ] HTTPS, correct `/mcp` endpoint and protocol negotiation verified
- [ ] Anonymous scope/read-only restrictions understood
- [ ] Five-session limit and rate limiter tested from real client IP
- [ ] Credential question works without logging or returning tokens
- [ ] Session end erases gateway credentials
- [ ] Unsupported local bridge workflows remain routed to appropriately authorized tools

**Questions:** [Open an issue](https://github.com/QREWGrp/qumi-tools-gateway/issues) for bugs and non-sensitive feature requests; send vulnerabilities privately per [SECURITY.md](../SECURITY.md).
