# Security policy

The **Engineering MCP Gateway** is open-source software under the [MIT License](LICENSE). This security policy explains how to report vulnerabilities and the boundaries of the publicly accessible gateway with bounded writes.

## Reporting a vulnerability

**Do not disclose an exploit, real provider token, session bearer ID, credential-response ciphertext, or affected user data in a public GitHub issue.**

Contact **support@qr-oo.com** with subject **"Security: qumi-tools-gateway"**. Include a minimal reproduction using **synthetic tokens**, the tested commit/version, affected MCP endpoint or tool, severity, and any mitigation. Do not send real credentials. A maintainer can coordinate private reproduction and a fix. No guaranteed response or remediation SLA is promised by this volunteer/open-source project.

For ordinary questions, feature requests, and non-sensitive bugs, use [GitHub Issues](https://github.com/QREWGrp/qumi-tools-gateway/issues).

## Threat model and security limits

This project is intentionally a **public, anonymous service with both read-only and confirmation-gated write tools** for compatible AI clients. There is no identity provider and no database. It must not be represented as a trusted multi-tenant execution platform for unrestricted CLI usage.

- **MCP sessions:** Random server-issued bearer identifiers, bound to the observed source IP, with a five-sessions/IP limit in the **single running process**. Session IDs are credentials and must not be logged or shared. IPv4/IPv6 spoofing is mitigated through a trusted Fly proxy when configured correctly, but IP addresses are not reliable individual identities.
- **Rate limits:** Default 60 requests/minute/IP and 30/session, with HTTP `429`. Shared NATs share a quota; distributed attackers can use multiple IPs. A single designated coordinator Machine holds the five total sessions. Secondary Machines must replay session requests to that coordinator; there is no shared durable session store.
- **Secrets:** The secure browser form accepts only an encrypted, short-lived, one-time token submission via HTTPS. Provider tokens live in process memory, not a persistent vault or repository. Process-memory clearing is **best-effort**, not a guarantee of zero residual copies in all buffers.
- **Expiry and revocation:** `session_end` and HTTP `DELETE` revoke the gateway session and invalidate its credentials. An abandoned browser tab may not notify the server; idle expiry (default 10 minutes) and absolute expiry (default 30 minutes) apply. These controls do **not revoke credentials at the upstream provider**.
- **Commands:** Read-only inspection plus constrained Fly Machine start/stop/restart, IONOS DNS record CRUD, npm distribution-tag changes, and Depot CI run cancellation. Each write requires a personal provider token and one-time browser confirmation. Arbitrary shell, package scripts, npm publishing, image-build context uploads, and unrestricted CLI flags remain prohibited.
- **Hosting:** Use TLS. Never expose the underlying Node HTTP listener directly to the Internet when `TRUST_FLY_PROXY=1`; trust `Fly-Client-IP` only behind Fly Proxy. For a different reverse proxy, configure and review the client-IP trust boundary before public deployment.
- **Vaults:** The gateway does not open users' ChatGPT/Claude/Codex saved passwords or Cloud Personal Vault secrets. Operators may use their own password manager to fill the portal manually. Do not ask for `VAULT_PASSPHRASE` in chat.

## Maintainer checklist

Before a production release, verify the runtime build, dependency/CLI source integrity, test coverage, CSP and CSRF protections, secrets redaction, session expiry and IP/rate caps, logs, Fly health checks, and a real supported MCP client connection. Never bypass pinned checksum verification just to make an image build.

Review any change that expands write permissions, registers new CLI command families, enables user-selected external URLs, or modifies session storage as a **security-impacting API change**. Public source publication or a merged PR does not mean a particular remote deployment has been tested or approved.

## Supported versions

Use the latest reviewed release on the [default branch](https://github.com/QREWGrp/qumi-tools-gateway). Versions, revisions and Docker images should be pinned in deployment records. Unsupported historical versions may contain known risks; deployers are responsible for their own infrastructure and keys.

## License

[MIT](LICENSE). The software is provided without warranty. See the license for the exact legal terms.

## Provider write approval limitations

The write_begin tool records validated operation parameters and returns a one-time approval link. After user confirmation in a protected HTTPS page, write_execute consumes the ticket before invoking the provider. The provider's own API enforces token scopes; the gateway cannot grant broader privileges. Approval is not proof of human presence, because an autonomous agent with browser access might attempt to interact with the page. For sensitive workflows, require explicit client-side tool permissions and least-privilege tokens. A timed-out mutation may have succeeded; verify state before retrying. All approvals expire after two minutes and are cleared on session end.
