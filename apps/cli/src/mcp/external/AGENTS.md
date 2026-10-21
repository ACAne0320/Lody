# External local MCP

Parent rules govern internal Session tools. This directory owns the separate
external entry contract: [Spec](../../../../../specs/external-mcp.md), with
implementation background in the [parent README](../README.md#http-and-loopback).

- External HTTP MCP uses `mcp/call-external-tool`, a separate local bearer token
  and an allowlisted catalog. Recheck token and exact owner/workspace/machine
  scope in the daemon. Never trust internal Session headers or ambient
  `LODY_SESSION_ID`, and never open a second workspace replica.
- Tokens grant access as the bound user. Local composition performs no cloud
  authentication. External Session reads/writes are own-user and own-machine;
  catalog reads retain the shared resource authorization rules.
- Claim each write before invoking its service. Persist fixed request/target ids
  and argument identity. Interrupted writes remain uncertain and are never
  automatically replayed; rotation must not make old ids reusable.
- External receipts have no parent Session or automatic Inbox continuation.
  Keep receipt files private and omit prompts, tokens and assistant output.
  Accepted means command return plus repo flush, not Agent completion.
- Revocation rejects new admission; it does not cancel an admitted command.
  HTTP waiter cancellation does not establish that daemon work has stopped.

- Discover the current MCP port through the daemon's local IPC health response.
  Never persist a second endpoint snapshot or expose the internal host token.
