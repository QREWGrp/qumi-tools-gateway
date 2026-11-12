# Contributing to the Open-Source Engineering MCP Gateway

Thanks for improving the gateway. This repository is publicly available under the [MIT License](LICENSE). Contributions are welcome from individual engineers and teams working with compatible web-chat MCP clients.

## Development setup

Install **Node.js 22+** and Git. There is no mandatory external database, identity provider or provider API key for the base tests.

```bash
git clone https://github.com/QREWGrp/qumi-tools-gateway.git
cd qumi-tools-gateway
npm test
npm run check
BIND_HOST=127.0.0.1 PORT=8080 npm start
```

The test server's local URL is `http://127.0.0.1:8080/mcp`; keep public deployments behind TLS. The image build also requires Docker or a Fly remote builder:

```bash
docker build --platform linux/amd64 -t engineering-mcp-gateway:dev -f Dockerfile .
```

Do not bypass the pinned Depot CLI checksum to make a failed build green.

## Pull request workflow

1. **Fork** the project and create a feature branch from the current `main`.
2. Keep changes focused and explain their user-facing behavior, security impact and protocol compatibility.
3. Update `README.md`, `docs/DEPLOY-FLY.md`, `docs/MIGRATION.md`, or the other guides if installation or behavior changes.
4. Add or update tests for changed functionality, especially session cleanup, rate limiting, CLI argument allowlists and credential redaction.
5. Run `npm test`, `npm run check`, and the Docker build if available. Include the exact command outputs and any limitations in your PR.
6. Submit a PR to `QREWGrp/qumi-tools-gateway`. A maintainer should review security-sensitive changes and the Fly build before merging.

We prefer small PRs with reproducible tests over undocumented broad refactors. CI requires the checked-out source tree to contain `Dockerfile`, `fly.toml`, `package.json` and `src/server.js` at the root.

## Security rules for contributions

- **Never commit real API tokens, passwords, `VAULT_PASSPHRASE`, session IDs, private MCP endpoints, encrypted vault files, or customer configuration.**
- Use clearly labeled **synthetic** secrets in unit tests.
- No arbitrary command execution, shell interpolation, provider URL injection, CLI script execution or expanded write permissions through an anonymous public MCP endpoint.
- Preserve the limit of **five live MCP sessions per IP per single gateway instance**. Any horizontal scaling PR must include shared rate/session coordination and a realistic abuse analysis.
- Minimize logging and redact secrets. Never log full credential questions, HTTP Authorization headers or MCP session bearer IDs.
- Treat browser and upstream MCP inputs as untrusted. Require protected HTTPS for credential provisioning and use strict one-time request validation.
- Any transition to write-capable tools needs a documented authorization and approval model, not simply a new CLI flag.

Report security vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than posting a proof of exploit in a public issue.

## Areas where help is welcome

Better CLI discovery and verified read-only adapters, MCP protocol compatibility tests (including newer stateless clients), improved Fly/Docker build verification, provider documentation, portable local development, secure rate-limit behavior, and independent ChatGPT Web compatibility testing.

## License

Contributions are made under the existing **MIT License** unless separately agreed. Retain copyright and license notices when redistributing code. Please do not submit proprietary code or third-party credentials you do not have the right to share.

**Project:** [QREWGrp/qumi-tools-gateway](https://github.com/QREWGrp/qumi-tools-gateway) · **Support:** support@qr-oo.com
