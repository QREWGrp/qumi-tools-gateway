# Engineering MCP Gateway

A lightweight **public-source, no-login, no-database** HTTPS MCP gateway for web agents. It federates a **restricted read-only subset** of the Depot and npm CLIs through one endpoint. Engineers can connect from ChatGPT Web or other Streamable HTTP MCP clients, if their platform supports connecting to unauthenticated custom MCP endpoints.

**Source:** [QREWGrp/qumi-tools-gateway](https://github.com/QREWGrp/qumi-tools-gateway) · **Publisher:** Qumi Teknolojis (trading name of QROO Inc.) · **Support:** support@qr-oo.com.

> **Security boundary:** a public, anonymous MCP gateway must not be an arbitrary remote shell. The gateway deliberately rejects `npm install`, `npm run`, `npm publish`, `depot build`, deployment, arbitrary file paths, user-selected registries and other state-changing commands. It is not yet a replacement for the full local bridges. The complete local engineering plugins remain at [QREWGrp/qumi-tools](https://github.com/QREWGrp/qumi-tools).

## First run: 1 → 2 → 3

1. **Deploy once:** From this repository, create an independent Fly app and deploy the Dockerfile via `fly.toml` (see [Fly deployment](docs/DEPLOY-FLY.md)). Do not deploy into the QUMI production application. The first supported deployment is **one Machine in one region** so in-memory session caps are global to the gateway instance.
2. **Connect from ChatGPT Web:** Add the actual deployed `https://<your-fly-app>.fly.dev/mcp` URL as a custom MCP server if the client permits it. No username/password or provider token is needed just to discover tools. Open a ChatGPT session, call `gateway_status` and `cli_catalog`.
3. **Use tools:** `cli_help` and allowed public npm reads require no API key. For authenticated reads call `credential_begin({provider:"depot"})` or `credential_begin({provider:"npm"})`, open the short-lived HTTPS credential question, and have your password manager or personal secrets vault fill **that protected form**. Never paste tokens into chat. Call `session_end` when finished, or let the MCP client send HTTP `DELETE /mcp` with its session ID.

## Tools

| MCP tool | What it does |
|---|---|
| `gateway_status` | Session lifetime, token presence (boolean only), limits |
| `cli_catalog` | Live adapter and supported command inventory |
| `cli_help` | Safe help for installed npm/Depot CLI subcommands |
| `cli_read` | Read-only npm ping/view/search/whoami and Depot project/build listings |
| `credential_begin` | One-time protected HTTPS question for Depot/npm token |
| `credential_forget` | Immediately remove a provider token from memory |
| `session_end` | Immediately revoke session, pending links and token buffers |

Depot command syntax is verified at runtime against the installed CLI version; unsupported subcommands return a harmless error. The container includes npm with Node 22 and pins an official Depot release by its published SHA-256. See `Dockerfile`.

## No signup, no database, no persistent vault

Every connected MCP session has its own randomly generated 256-bit bearer capability in `MCP-Session-Id`, bound to its Fly-reported source IP. Tokens enter only via a one-time protected HTTPS page (the browser additionally wraps them using ephemeral RSA-OAEP/AES-GCM). The gateway stores tokens in **process memory only**. It does not read a ChatGPT/Claude/Codex password manager or private vault automatically—those services may autofill the browser form only with operator consent.

- Explicit `DELETE /mcp` or `session_end`: immediately revoke the session, abort in-flight commands, clear credential buffers and invalidate pending links.
- Idle timeout: 10 minutes. Absolute session lifetime: 30 minutes. Startup/restart loses all sessions and tokens.
- **Important:** closing a chat tab does *not necessarily* send `DELETE`. Unless the MCP client closes the session, resources are cleared at expiry. Gateway session revocation does **not revoke the user's underlying npm/Depot token** at its issuer.
- Session tokens are bearer credentials; never log or share them. JavaScript memory cleanup is best-effort and does not guarantee physical zeroization of immutable strings or all process copies.

## Abuse controls

- Hard cap **5 active MCP sessions per client IP**. Sixth returns HTTP `429`. Deleting/expiring a session frees its slot.
- Default **60 requests/minute/IP**, **30 requests/minute/session**, with `429` + `Retry-After`.
- Global caps: 200 sessions, 8 child commands, 2 simultaneous commands/session, 50 pending secure questions; 10s command timeout, 32 KiB output cap and 24 KiB request-body cap.
- Only trust `Fly-Client-IP` with `TRUST_FLY_PROXY=1` *behind Fly Proxy*. Ignore user-supplied `X-Forwarded-For`. A production client outside Fly must use the socket peer address instead.
- One-machine deployment is required for an actual cross-request five-session/IP guarantee; scaling to two Machines without shared state makes the limit **per Machine**, not global.
- No shell injection, no dependency scripts, no registry overrides, no persistent working directory or checkout mounts, no arbitrary CLI flags.

IP-based controls are not an identity system. Shared NAT IPs also share five slots; determined attackers can use many IPs. A public gateway requires ongoing abuse monitoring and may need stronger access controls if full mutation capabilities are ever added.

## MCP protocol compatibility

The gateway offers **Streamable HTTP MCP 2025-11-25** with server-issued `MCP-Session-Id`. It supports `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` and session termination via HTTP `DELETE`. The newer 2026-07-28 MCP transport removed protocol-level sessions, so a client requiring *only* that revision needs a separate per-request-capability adapter before production compatibility can be claimed. External ChatGPT Web connection has **not** been live verified.

## Local development

```bash
npm test
npm run check
BIND_HOST=127.0.0.1 PORT=8080 npm start
```

For localhost development, the local session bridge is at `http://127.0.0.1:8080/mcp`. For public service, Fly terminates HTTPS and sets the `Fly-Client-IP` header; the Node process itself listens on port 8080 over private HTTP. Never point production ChatGPT clients to an HTTP endpoint.

## Deployment status

This public repository contains **deployable source and tests**, not an already-running Fly app. You must provision the Fly application, pay any hosting charges and verify the live MCP handshake separately. No provider tokens, user domains, account secrets, database credentials or Fly deployment tokens are committed.
