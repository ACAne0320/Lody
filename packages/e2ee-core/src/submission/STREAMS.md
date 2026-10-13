# Full-history SDK submission adapter

`./submission/streams` supplies a Scope-owned `SubmissionRemote` for the structural
read/CAS shape of released streams-client0.9. Runtime owns no SDK package/client,
URL, credentials, production composition or timers. The caller initializes one
borrowed SDK and independently selects each exact head/count checkpoint.

Read always audits complete original history from `-1` with the shared framed
reader, fixed genesis, real signatures and prior genuine-prefix continuation.
It validates the endpoint before retaining its corresponding opaque offset; remote
headers, last hashes and up-to-date flags never select checkpoint trust. Budget
failure, corrupted history, incomplete/cyclic positions or closure do not replace
this mapping. Empty pages cannot jump position. Local budgets are explicit up to
one million records/64MiB; each framed read remains bounded by the reader. SDK0.9
buffers responses upstream, so these bounds do not cap SDK allocations.

CAS requires a matching genuinely verified mapping, an ordinary signed record
that really extends that history, and original u32be framing. No producer/retry,
ordinary append fallback or offset ordering is invented. Unsupported/conflict or
uncertain ACK is a typed remote failure. Even successful ACK leaves the mapping
unchanged; P09 must read back and independently decide Committed/Conflict. The
journal owns exact original persistence and result acknowledgement.

The shared reader cancels AbortSignal-enabled reads and awaits actual raw
settlement. SDK0.9 `appendCas` has no per-call AbortSignal: this adapter retains and
awaits the exact request on interruption/Scope close, rejects late completion and
creates no Runtime/background fiber. Caller SDK timeouts must be bounded; if raw
SDK/native work never settles, local close cannot truthfully prove it stopped.
Cancel/await borrowed checkpoint effects before destroying their owner, and close
this Scope before destroying the borrowed SDK.

This is full audit only. Qualified snapshot bootstrap, protected snapshot-offset
AAD, sender-publication reconstruction and the actual Lab are later consumers.
The tests use the actual registry SDK, loopback synthetic HTTP gateway and real
SQLite/P09, including another OS process reopening the journal. Their trusted
checkpoint comes from synthetic fixture control state rather than HTTP metadata;
this is not deployed backend, native custody, original Lab2 or production E2EE.
