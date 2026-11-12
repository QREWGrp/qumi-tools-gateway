# Open-Source HTTPS Gateway for AI-Powered Agents

**Use the gateway from your web-chat client—or fork and build your own.**

> **BOOST YOUR BUILD FROM DAY ONE — Fork and build your self-hosted gateway for free.**  
> **No credit card required to obtain, fork, study, or run the open-source software locally.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) · [Self-host free](docs/SELF-HOST.md) · [Fly deployment](docs/DEPLOY-FLY.md) · [Migration guide](docs/MIGRATION.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [GitHub source](https://github.com/QREWGrp/qumi-tools-gateway)

A lightweight, public-source **Streamable HTTP MCP gateway** intended for ChatGPT Web and other compatible AI agents. It runs a restricted, **read-only** subset of the Depot and npm CLIs, with no identity-provider integration, user database, shared provider tokens, or persistent secret vault.

**Get started in three steps:** **fork or clone** → **run locally or deploy to your HTTPS host** → **connect the MCP URL from a compatible agent**. See [deployment](docs/DEPLOY-FLY.md) for the exact Docker/Fly setup and [migration](docs/MIGRATION.md) if you're moving from local CLI bridge plugins.

**Costs, clearly stated:** The **software** is free and licensed under MIT. Using GitHub to fork it and running it on your own computer require no payment to this project. A **public HTTPS host may charge**; Fly.io's current pricing and billing terms are independent of this repository and may require a payment method. An invitation to use the gateway does **not** guarantee that QUMI operates a free shared endpoint.

**Publisher:** Qumi Teknolojis (trading name of QROO Inc.) · [QUMI](https://qumi.app) · [QROO](https://qr-oo.com) · Contact: support@qr-oo.com.

## Choose your installation

| Mode | What you get | Authentication/storage |
|---|---|---|
| Local development | Node.js MCP server on `http://127.0.0.1:8080/mcp` for testing | No account/database; test only, not public HTTPS |
| Your hosted gateway | Deploy with Docker or Fly.io and connect `https://your-host/mcp` | Session-scoped bearer IDs and optional browser-provisioned provider tokens |
| A public gateway operated by somebody else | Connect only after independently verifying the operator, endpoint, security and capabilities | Never hand over provider tokens to an untrusted host |

**Important boundaries:** This is not an anonymous remote terminal. It does not run arbitrary shell commands, deploy infrastructure, install packages, or publish npm packages. The maximum is **five active sessions per IP per instance**, with per-IP and per-session rate limits, short-lived credentials, and explicit MCP session termination. The gateway does not automatically read an agent's personal password manager or cloud vault.

---

## Technical overview

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

## Deployment and readiness

**The original Fly 'could not detect runtime or Dockerfile' error occurred because `main` initially contained only README.md while the actual app lived in an unmerged PR.** Do not deploy the default branch until it contains `Dockerfile`, `fly.toml`, `package.json` and `src/server.js`.

For a first deployment, use an **explicit Dockerfile build**, not `fly launch` source detection. Full instructions: [docs/DEPLOY-FLY.md](docs/DEPLOY-FLY.md).

```sh
git clone https://github.com/QREWGrp/qumi-tools-gateway.git
cd qumi-tools-gateway
test -f Dockerfile && test -f fly.toml && test -f package.json
fly auth login
# One time only, if the app does not already exist:
fly apps create qumi-tools-gateway --org qrguru
fly config validate -c fly.toml
fly deploy --app qumi-tools-gateway --config fly.toml --dockerfile Dockerfile --remote-only --strategy immediate
fly scale count 1 -a qumi-tools-gateway
fly status -a qumi-tools-gateway
```

No account-specific credentials or gateway tokens are stored in this repository. Its default Fly URL will be `https://qumi-tools-gateway.fly.dev/mcp` **only after an app by that name is created and deployed successfully**. There is no evidence of a running endpoint until Fly reports a healthy Machine and an external MCP handshake succeeds.

**Validation levels:** Source tests can pass without Docker; GitHub CI must also successfully build the pinned Depot CLI into the image and smoke-test the container; production must pass Fly health checks and a live MCP acceptance test from a supported client. No live Fly build or external ChatGPT connection is claimed without results.

**Protocol support:** The server negotiates session-based MCP revisions `2025-03-26`, `2025-06-18` and `2025-11-25`. The stateless `2026-07-28` revision is not implemented and needs a separate compatibility adapter. This is an explicit compatibility limit, not a silent fallback.

**Scope:** This gateway is intentionally anonymous and read-only. Public CLI discovery and limited read operations are provided, but arbitrary command execution, npm publishing and infrastructure-changing operations are disabled. Credentials remain memory-only per session. The five-sessions/IP cap is enforced **per instance**; deploy one Fly Machine and use an immediate replacement rollout to avoid multiple simultaneous session stores. A browser/tab close does not necessarily revoke an MCP session; call `session_end` or HTTP `DELETE`, otherwise idle/absolute expiration applies.
