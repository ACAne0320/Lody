# Permanent publisher loss: new-key recoverability proposal

Status: draft
Translation: current

[中文](publisher-key-recoverability.zh.md)

## Risk and settled rules

Local durability covers process crashes, not permanent device loss. A committed epoch can lose its key before another recoverable holder exists. Installation reports prove past reports, not continuous custody; stored envelopes alone do not prove custody either. Do not assume everybody has Recovery, deliver to not-yet-effective ordinary devices, or call asynchronous post-commit delivery a pre-publication backup.

## Recommended A: independent protected candidate before publication

After history self-check and fixing original signed bytes, save a separately readable encrypted candidate bound to publisher-candidate/v1 purpose, Org, original previousHash, nextEpoch, commitment and original signed-record hash. Retain original record bytes. An already configured vault that can actually be unlocked may hold a dedicated candidate entry. Without vault/Recovery, the publisher may create an operation-specific recovery file and encrypted candidate copy, or configure recovery first. This is not an ordinary mailbox envelope, grants no pending device authority, and needs no online Recovery device.

Reuse existing algorithms with a separate backup purpose. Vault access is controlled by its entry secret; an operation-specific file uses an independent random unlock secret. The user must save a readable copy outside the publisher device. Upload success alone or another file on the same disk is insufficient. Before CAS, read back/decrypt from the independent medium and verify commitment/record binding. Otherwise retain local edits/intent and show not submitted. Cloud confirmation still trusts the existing host to retain/provide ciphertext and does not resist malicious deletion. File storage also depends on user-confirmed independent custody; readback cannot cryptographically prove permanent availability outside the device.

The backup-entry holder, not the server or arbitrary members, can recover the candidate. First verify the actual ledger. Use it as a published epoch only after verified original-record inclusion and current qualification for key retrieval/further operations. Conflicted/cancelled candidates cannot be installed or silently submitted. Without qualification, cleanup of one's backup remains possible. Secret file holders already possess candidate material; it cannot be cryptographically recalled, so never share it with the removal target. Ordinary delivery remains post-inclusion to active recipients. An operation-specific file retains the new key, not Recovery or other device private keys. If the final management device is lost without active Recovery/another authorization path, management identity still cannot be recovered. A defines completion of an independent key copy, not an account backdoor or guaranteed usability after every device is lost.

Recommend this independent copy as a prerequisite for genesis/rotation/D12 publication, retained until an independently verified recovery path exists and the user elects cleanup. Reconcile references before removing terminal conflicted candidates; never erase the sole backup of an unknown outcome. This adds publication waiting, file custody/unlock and cloud-availability costs and needs product approval. Ordinary registration/join remains available; optional ordinary recovery setup remains settled.

## Alternative B: accept the permanent-loss window before first delivery

Require local protected durability only, then deliver after inclusion to currently qualified ordinary/Recovery devices. Show independent recoverability only after verified durable installation by another device, or an actually recoverable offline Recovery envelope/private package. Allow publication while incomplete with explicit possible permanent loss of this epoch and later content. Holders are post-commit devices/recovery entries, never future ordinary devices. Simpler experience, but no guarantee between CAS and the first independent copy; accepting this risk needs approval. Recommend A; B is a reviewable alternative, not the default implementation.

## Approval delta and limits

The A/B publication gate, operation-specific entry without a vault, and retention are new product/backup semantics. Names and reuse of algorithms are engineering choices. Review the backup envelope/readback evidence and vault wrapping together before implementation. No server plaintext custody, universal Recovery assumption, threshold escrow or early ordinary-device admission. U03B remains excluded.

## Evidence

[Key protection boundary](../../packages/e2ee-core/src/keys/HOST-PROTECTION.md), [whitepaper](whitepaper.md). No passing permanent-publisher-loss recovery claim; the current Lab OS-child evidence covers process reopen only.
