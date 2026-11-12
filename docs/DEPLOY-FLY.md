# Fly.io deployment — Engineering MCP Gateway

This is a **separate public read-only MCP app**, not part of a production QUMI application. It does not need an identity-provider account or database. The app uses a single instance, short-lived per-session credentials and a cap of five active MCP sessions per IP.

## Diagnose the original Fly launch failure

On November 12, 2026, `main` contained only `README.md`; the Dockerfile and application lived in PR #1. Fly's GitHub-source launcher scanning `main` therefore correctly reported **"Could not find a Dockerfile, nor detect a runtime"**. Merge the release source before launching from `main`, or explicitly use the committed source checkout.

## 1. Download the application and verify build context

```sh
git clone https://github.com/QREWGrp/qumi-tools-gateway.git
cd qumi-tools-gateway
git switch main
git pull --ff-only
test -f Dockerfile && test -f fly.toml && test -f package.json && test -f src/server.js
npm test
npm run check
```

**Windows PowerShell equivalent for the file check:**

```powershell
@("Dockerfile","fly.toml","package.json","src/server.js") | ForEach-Object {
  if (-not (Test-Path $_)) { throw "Missing deployment source: $_" }
}
```

If these files are missing, you are on the wrong branch or in the wrong directory. Do **not** run `fly launch` from an empty README-only checkout or a parent directory.

## 2. Create the Fly application (if necessary)

```sh
fly auth login
fly apps list
fly status -a qumi-tools-gateway
```

If the status call says the app does not exist and the name is still available, create it in the intended organization:

```sh
fly apps create qumi-tools-gateway --org qrguru
```

If the application already exists, do not create a duplicate. If another owner took the name, choose a new available name, update the `app` field in `fly.toml`, and deploy with that same app name. The `ams` primary region is a default, not a hard-coded user location requirement.

## 3. Validate and deploy the **explicit** Dockerfile

```sh
fly config validate --config fly.toml
fly deploy --app qumi-tools-gateway --config fly.toml --dockerfile Dockerfile --remote-only --strategy immediate
fly scale count 1 --app qumi-tools-gateway
fly status --app qumi-tools-gateway
fly checks list --app qumi-tools-gateway
fly logs --app qumi-tools-gateway
```

The build compiles the documented Node.js runtime and downloads the official, SHA-256-verified Depot CLI. Fly builds the image remotely; no Docker installation on your workstation is necessary. The existing `fly.toml` configures HTTPS, HTTP port 8080, `/healthz` checks and a single shared 512 MB Machine target.

**Why one Machine?** Each MCP session and IP-rate counter lives in local process memory. Two Machines would each allow up to five sessions/IP, so only a single-instance deployment matches the intended cap. Immediate replacement avoids two concurrent running versions during rollout but may cause brief downtime. A future HA deployment requires shared session state and distributed rate limiting.

## 4. Verify the running service

Only after Fly reports a healthy machine, test:

```sh
curl --fail --show-error https://qumi-tools-gateway.fly.dev/healthz
```

Expected: `{"status":"ok","service":"engineering-mcp-gateway"}`.

Run a safe MCP initialize and tools/list check with a compatible client, then the five-sessions/IP and delete/reconnect regression using **synthetic credentials only**. Confirm the sixth session receives 429, deleting one frees its slot, a terminated session cannot be reused, and the read-only tools reject mutation attempts.

The endpoint `https://qumi-tools-gateway.fly.dev/mcp` is a **target URL**, not proof of a deployed application. A ChatGPT Web connection remains an independent acceptance gate: clients requiring *only* the stateless 2026-07-28 MCP transport will need an adapter.

## Safety and operations

- **No CLI shell:** only allowlisted read-only npm/Depot commands are executed. No installer, publishing, registry changes, or arbitrary disk access is available to anonymous callers.
- **Ephemeral tokens:** credentials enter only through one-time encrypted HTTPS questions and are not stored on disk. Explicit `session_end` or HTTP `DELETE` revokes the gateway session, while inactivity triggers expiry. This does **not** revoke the underlying credential at its provider.
- **Rate limits:** maximum five sessions/IP, 60 requests/minute/IP, 30 requests/minute/session, 200 total sessions, and bounded process concurrency. Shared NAT networks share the per-IP quota.
- **Reverse-proxy trust:** only set `TRUST_FLY_PROXY=1` when Fly Proxy exclusively exposes the runtime; otherwise use direct socket IP. Fly's internal HTTP health checks do not require a public Host or Fly client-IP header.
- **No stored vault:** personal ChatGPT/Codex/Claude secret managers may supply a token to the operator's browser, but the remote gateway cannot read them automatically.
- **No deployment claims without evidence:** source validation, Docker build, Fly Machine health, provider authentication, and real ChatGPT Web compatibility are distinct gates.

If the built container fails on Depot installation, inspect the exact Docker build log, verify the tagged Depot release and SHA-256, and fix the pinned values in a reviewed PR. **Never bypass checksum verification** to force a deployment.

## Docker build fix: Depot archive entry name

If Fly reports a failure after `sha256sum --check --status` at `tar -tzf /tmp/depot.tgz | grep -qx 'depot'`, the pinned archive downloaded and passed checksum validation but its executable entry name was not exactly `depot`. This is a packaging/layout mismatch, not a Fly authentication or image-registry issue.

The downloader now uses `scripts/extract-depot.sh` to locate exactly one archive member ending in `/depot` (or `depot` at the root), extract only that entry into `/tmp/depot-release/depot`, and mark it executable. It deliberately **preserves** the upstream pinned version and digest. Run `npm test` for root/nested archive regressions, then deploy the image from the current `main` commit. The actual upstream binary image build still requires Fly or Docker acceptance.
