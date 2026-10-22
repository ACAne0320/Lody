# Machine E2EE custody

`CLAUDE.md` is a symlink to this file. Parent CLI rules apply.

- This module is lazy and machine-only. Ordinary CLI startup must not probe the keyring.
- First creation probes a temporary Secret Service / Keychain / Credential Manager entry
  by write/read, then permanently selects os-keystore or file protection. Reopen never probes
  or changes that selection. Missing selector or KEK with existing originals is a failure.
- File protection requires owner-only directories/files, no symlinks; Windows uses actual
  owner/DACL checks through the official process Layer, not Unix mode bits.
- Keep common blob formats in core's node-custody adapter; no personal management operations,
  private exports, plaintext device files, or silent downgrade after keyring errors.
- A future machine pairing flow must display file protection before the user approves it.

- Native keyring calls run in a managed helper: 10-second timeout, secrets only on stdin.
  Confirm termination before fallback; preserve process-release recovery owners.
- Windows batches root/file ACL checks in one process. SQLite selection uses asynchronous
  bounded retry on SQLITE_BUSY, never a blocking busy_timeout while awaiting keyring work.

- An interrupted first Windows ACL setup can resume only while the custody directory
  is completely empty. Any existing file makes this a validation-only open.
- `runtime.ts` composes core's Feed/VerifiedLedger, installed keys and optional receiver.
  Open and local status never call the network. Cloud requests stay in cloud-cli-port.
- Journal original records before feed/pin advancement. Rebase after 64 additional
  records; core advances the pin first. Retired cache cleanup cannot fail local open.
- No plaintext RPC, presence, attachments or scheduled automation may be attached to
  an encrypted workspace while their encrypted channels remain unimplemented.
- `prepareCliE2eeMachineLegacy` binds the retained credential hash to the exact
  desktop-generated 16-byte pairing session using core's fixed v1 helper.
  Pairing preparation and activation run only on the OS-user control socket;
  Fleet checks its own account and discovered encrypted workspace/genesis first.
  Activation refreshes the verified ledger and mailbox and acknowledges only an
  installed current key; temporary failure leaves the same pairing retryable.

- M2 content bindings pin their write epoch; an epoch change or rotation-required
  flag latches new sends off while local state remains intact. M3 owns resumption.
- A prepared binding alone cannot start a content replica. Activation first runs
  only the native ledger/key receiver, checks a verified current key, closes that
  temporary owner, then writes `activation.json`. Fleet can now attach rooms.
  The marker grants no authority and is checked against genesis/device identity;
  existing activated workspaces can reopen locally without network. Concurrent
  activation requests join per workspace, and Fleet shutdown drains them before
  closing its cloud port.

- Fleet must not construct/register the PR poller for encrypted workspaces. It owns
  hosted GitHub credential/association ports independently of Lody's cloud-port
  restrictions and would disclose decrypted repository/branch metadata.
- The encrypted Lody cloud port also omits hosted GitHub tokens. SessionManager
  must use host git/gh credentials, without sending decrypted repository names
  through its separately owned credential broker.
