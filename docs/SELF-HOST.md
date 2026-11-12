# Self-host your HTTPS MCP gateway

**Fork it. Run it. Own the endpoint.** The [source code](https://github.com/QREWGrp/qumi-tools-gateway) is licensed under [MIT](../LICENSE); no account, credit card, paid license, identity-provider service, or database is required to develop or operate it **locally**. A public Internet deployment requires hardware, networking and TLS, which may involve costs charged by a hosting provider.

## 1. Fork or clone and run locally

Prerequisites: Node.js 22+ and Git.

```bash
git clone https://github.com/QREWGrp/qumi-tools-gateway.git
cd qumi-tools-gateway
npm test
npm run check
BIND_HOST=127.0.0.1 PORT=8080 npm start
```

On Windows PowerShell, use:

```powershell
$env:BIND_HOST = "127.0.0.1"
$env:PORT = "8080"
npm start
```

Visit `http://127.0.0.1:8080/healthz`. This endpoint is for **local development only**. ChatGPT Web and other remote AI agents generally cannot reach your local loopback address.

## 2. Build your own container

With Docker available:

```bash
docker build --platform linux/amd64 -t engineering-mcp-gateway:local -f Dockerfile .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e PORT=8080 -e BIND_HOST=0.0.0.0 -e TRUST_FLY_PROXY=0 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8080 \
  engineering-mcp-gateway:local
```

The Dockerfile retrieves the pinned Depot CLI release over HTTPS and verifies the expected SHA-256; do not disable checksum verification. The container runs under a non-root user.

The Docker command above is for **localhost testing** and does **not** enable public HTTPS.

## 3. Expose a public HTTPS MCP endpoint safely

For Internet-facing hosting:

- Use a dedicated server/container separate from your production applications, with no production filesystem mounts or arbitrary CLI execution privileges.
- Put a **trusted TLS reverse proxy** or platform TLS terminator in front of the Node HTTP listener. Use a valid hostname and HTTPS certificate; configure `PUBLIC_BASE_URL=https://your-hostname`.
- Restrict direct access to the Node port. If not behind the real Fly Proxy, set `TRUST_FLY_PROXY=0`. Review how your proxy conveys real client IPs; **do not** trust arbitrary `X-Forwarded-For` from Internet callers. If you see the proxy address for all requests, rate limiting will count them together; you must design a trusted proxy-to-application IP boundary before inviting public traffic.
- **Keep one gateway process** until rate limiting and sessions use shared coordination. More than one instance means the five-sessions/IP cap applies separately to each instance.
- Verify `/healthz` and a client-supported `/mcp` initialization. Test deletion/expiry, max five sessions per IP, and refusal of mutating CLI commands before announcing your endpoint.
- Never embed provider tokens, personal `VAULT_PASSPHRASE`, private vault files, or sensitive customer endpoints in the image or its Git repository.

An operator can use compatible web-chat agents only after deploying a publicly reachable, verified HTTPS endpoint. The repository does not operate a guaranteed public shared gateway.

## Optional Fly.io deployment

See [Deploy on Fly.io](DEPLOY-FLY.md), which uses the repository root `Dockerfile` explicitly to avoid missing-runtime detection. Fly.io is a **separate hosting provider**: trial eligibility, credit-card requirements, and compute/network charges follow Fly.io's own terms, not this MIT project. Check [Fly.io pricing](https://fly.io/docs/about/pricing/) and [free-trial requirements](https://fly.io/docs/about/free-trial/) before deploying.

## MCP transport and session model

The service currently supports Streamable HTTP with **server-issued MCP sessions**, explicit DELETE and `session_end` revocation, plus idle/absolute expiry. It is not yet a stateless-MCP gateway. CLI operations are intentionally restricted to documented read-only commands. Provider tokens can be entered through a one-time protected question; they remain only in process memory until session expiry or revocation.

Review [security policy](../SECURITY.md), [migration guide](MIGRATION.md) and [contribution guide](../CONTRIBUTING.md) before extending tool permissions.
