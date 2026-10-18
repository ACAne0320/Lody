# Report Claude quota restrictions at the correct lifecycle boundary

Status: implemented
Translation: current

Host PR: [LodyAI/Lody#1701](https://github.com/LodyAI/Lody/pull/1701).

Adapter PR: [LodyAI/acp-extension-claude#43](https://github.com/LodyAI/acp-extension-claude/pull/43).

[中文](2026-10-19-claude-goal-quota-notifications.zh.md)

## Abstract

Claude quota restrictions could disappear into context-usage metadata, leaving the
user waiting without an explanation. Lody now publishes a notice as soon as the
restriction arrives and returns an ACP error at the applicable native end boundary,
including idle or actual stream end when no result arrives. The SDK stream, queued prompts and other
background tasks retain their own lifecycle. Deterministic tests cover early
notification, terminal accounting, delayed idle messages, recovery and runtime
reuse; no live account restriction was exercised.

## Cause and correction

The SDK's `rate_limit_event` previously produced a `usage_update` only after a real
assistant usage observation. The host consumed context size and token count,
ignoring `_claude/rateLimit`; before that observation the adapter emitted nothing.
Explicit quota prose could arrive, but the terminal failure was classified as an
internal error and did not update the goal.

A restriction event confirms a quota fact, not that the SDK process or every task
has ended. The adapter reports the restriction and continues consuming native
messages; existing native end boundaries determine prompt settlement.

## Event ordering and ownership

ACP v1 ends a `session/prompt` through its result or JSON-RPC error response;
notifications do not settle it. ACP does not prescribe a Claude SDK `result`
frame or a quota-specific stop reason. See [error handling](https://agentclientprotocol.com/protocol/v1/overview#error-handling)
and [prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn).
Claude SDK 0.3.293 defines rate-limit events as status changes. The
adapter's existing lifecycle already treats unowed idle for an active turn and
actual EOF as end boundaries. This fix projects quota failure at those same
boundaries rather than requiring one particular frame or adding a timer.

1. A rejected subscription window without usable overage immediately publishes a
   Core error notice, even before the first model-usage observation. The notice
   includes the supplied epoch-second reset as ISO UTC, without claiming that a
   process was stopped. `allowed`, `allowed_warning`, and available overage retain
   their normal path. A native assistant quota explanation uses the same notice.
2. The current prompt remains pending until an applicable native end boundary. Quota
   notices retain their associated turn identity so an autonomous result cannot
   consume the foreground incident. They survive a delayed echo of the same turn
   and are cleared at the matching result or a different turn's activation.
3. A failed quota result preserves the original objective and publishes `limited`
   for an active goal. Its normal result path accounts for usage and rejects only
   that result's prompt with `errorKind: quota_exhausted`. Autonomous results report
   session facts without failing the next user's prompt. A successful result does
   not become a failure merely because an earlier restriction was observed.
   An unowed idle with an active, non-held, non-steering turn also returns the
   known quota error instead of the generic `no_result` error. A queued input's
   early idle and an earlier result's trailing idle cannot take this path.
   Background quota work reaching idle updates its goal without rejecting a
   queued user's input. Actual EOF reports the known quota error for its owning
   active or unstarted queued prompt, instead of returning success or a
   misleading recoverable session-disconnection error.
4. The host finalizes the turn through its existing error path, but quota exhaustion
   does not request process termination or automatic replay. `quotaNoticePublished`
   on the terminal error avoids a duplicate history notice; clients without an
   earlier notice retain the ordinary localized `acp_quota_exhausted` banner.
5. A live query remains available for the next explicit prompt. Trailing idle debt,
   native task lifecycle, cancellation and real stream shutdown keep their existing
   owners. No quota event cancels queued prompts, clears tasks, evicts the session,
   or invents task completion. AIR's typed session failures are unchanged.
   Actual EOF still runs the existing stream-end cleanup because that query has
   already ended; quota notification alone never initiates that cleanup.

The host's existing neutral notice handler persists the notice and maps `limited`
to durable `blocked`. The owning contracts are
[goal responsibilities](../../../../specs/session-goal-control.md) and
[notice presentation](../../../../packages/components/src/components/ai-gui/agent-notices.md).
Historical task reconciliation after restart is outside this repair.

## Lifecycle and Effect assessment

The provider adapter owns SDK interpretation and prompt-result association; the
host owns turn finalization and any actual process termination. Restriction
reporting neither cancels a waiter nor stops raw SDK work. Normal cancellation and
stream-end cleanup remain the release conditions. A terminal quota failure does
not destroy a live runtime or hand its ownership to a replacement; actual EOF
still releases the already-ended query.
The quota flag records successful notice delivery, not a claim that the model or
other processes were killed. Later explicit user input is the recovery trigger.

The fix retains the existing third-party SDK adapter and changes pure host error
classification plus history-notice selection. A native Effect migration would
expand into the unfinished ACP lifecycle chain in the
[migration ledger](../../proposed/architecture/2026-09-27-effect-lifecycle-migration-roadmap.md#unit-ledger).
No dependency or native ownership boundary changes in this work.

## Verification and limits

The actual SDK consumer is exercised with synthetic streams and explicit Promise
gates. Tests inspect the interval after notification but before result, then
release the result and verify goal state, final usage, queued-turn isolation,
delayed idle handling, untouched background task state and a second prompt on the
same query. Both native result error shapes, successful recovery, autonomous
quota errors, warning/overage cases and existing AIR behavior are covered.
No-result tests cover active and queued EOF, active idle, owed trailing idle,
idle before the input echo, and autonomous idle/EOF without a prompt waiter.

Host tests cover separate notice and later goal delivery, quota classification,
no automatic replay, runtime retention, turn release, and one visible history
notice with or without early notification. Package typechecks, adapter build and
lint/format checks, shared history/parser tests and component notice tests provide
additional checks. No live account, real quota reset or packaged desktop run was
used; tests do not establish the original reporter's account timing.

The isolated checkout against current main passed `pnpm check` and `pnpm format`,
including the full package test run and boundary guards.
Documentation checks retain the existing six broken Kimi/Pi links in the
subagent-events proposal; those files are unchanged. No Spec approval or release
is implied.
