# Read and write operations in the public QUMI MCP Gateway

## Security boundaries

The gateway supports read-only inspection and a deliberately bounded set of provider writes. A scoped provider token determines permissions at Fly.io, IONOS, npm or Depot. The gateway independently validates action names, target IDs, DNS types, npm package/version names, rate/session caps, and fixed destinations. A powerful token cannot turn this service into an arbitrary shell.

## Write workflow

1. Start an MCP session and provision your provider's token through credential_begin and the encrypted HTTPS form. Never put tokens in chat.
2. Call write_begin with an exact operation name and args. The gateway constructs a validated, fixed-host plan and returns approval_id and an expiring HTTPS approval link. No change is executed yet.
3. The operator opens the link, checks provider, target and action, and clicks Approve. Approvals expire after two minutes.
4. Call write_execute with approval_id. The server consumes the approval before contacting the provider, preventing replay and substituting new arguments.
5. Verify the result via read tools; do not automatically retry an uncertain timeout. Explicit session termination revokes unexecuted approvals and clears memory-held provider credentials.

## Supported bounded write operations

| Action | Required parameters |
|---|---|
| fly_machine_start / stop / restart | app, machine_id |
| ionos_dns_record_create | zone_id, name, type (A/AAAA/CNAME/TXT), content, ttl |
| ionos_dns_record_update | zone_id, record_id, name, type, content, ttl |
| ionos_dns_record_delete | zone_id, record_id |
| npm_dist_tag_add | package, version, tag |
| npm_dist_tag_remove | package, tag |
| depot_ci_cancel | org_id, run_id |

The Fly HTTP destination is fixed to api.machines.dev; the gateway blocks mutation of its own Fly app. The IONOS destination is fixed to api.hosting.ionos.com/dns. npm uses the official npmjs registry with fixed CLI arguments. Depot cancellation uses the official Depot CLI with a fixed organization/run ID. Any new action requires reviewed schema and tests.

## Safety limitations

The operator approval page is a confirmation workflow, not proof of individual identity or a guarantee against an agent that has independent browser interaction rights. Use least-privilege tokens and host-level permissions. A valid provider token cannot override the gateway allowlist and an invalid or under-scoped token will be rejected by the provider.

The active-session maximum remains five total across all Fly Machines through a single coordinator. Credentials and approvals are RAM-only; no user database or persistent vault. Killing or replacing the coordinator revokes all sessions. The write code is unverified against real provider accounts until integration acceptance is performed.
