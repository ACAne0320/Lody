# Keep long-running Live Activities tied to current session presence

Status: implemented
Translation: current

[中文](2026-10-11-live-activity-presence.zh.md)

## Abstract

Live Activity summaries still treated the durable `lastRunningSeen` field as a periodic heartbeat after session liveness moved to ephemeral presence. A running task could disappear from the next summary after three minutes, allowing a consumer to end its activity. The CLI now supplies one live-status map to all summary builders, using local turn ownership and fresh peer presence. An explicit durable `idle` remains completed because prompt exit precedes release of finalization presence. Tests exercise the real MessageHandler summary at three and 31 minutes; this does not establish real-device push delivery.

## Decision and boundaries

- Local sessions read `SessionActivePresenceController.getStatus`; transport suspension does not expire a task still owned by this process.
- Peer sessions use the shared freshness predicate over the current workspace presence snapshot. A missing presence runtime fails the best-effort summary instead of falling back to old metadata or inventing an empty snapshot.
- Items, candidate count, status counts and permission alert selection receive the same map. Never restore periodic doc-meta heartbeat writes.
- Prompt exit deliberately writes `idle` while presence still represents finalization. The summary honors that completion so its last send does not revive a finished task.
- Unread history remains available to consumers. A consumer deciding an activity's lifetime must use running/waiting counts, not unread history.
- No new polling, network retry, background owner, payload schema, or push-to-start policy is introduced. The existing 30-minute content freshness deadline remains distinct from activity termination.

A small Effect migration was assessed using the repository guide. This fix is synchronous projection inside the existing Promise notification boundary; migrating the MessageHandler/session owner would pull in unfinished dependencies without addressing the stale predicate. The current ownership remains unchanged.

## Evidence and limits

The existing permission-notification suite now calls the real summary with a real active-presence controller and a controlled clock. It covers unchanged durable timestamps at three/31 minutes, permission selection, idle during finalization, released local ownership, fresh/expired peers, and unavailable peer presence. It uses synthetic metadata and no network. Real APNs delivery, platform throttling and remote activity registration require device evidence separately.

Related ownership: [CLI presence](../../../docs/cli-lib-loro-presence.md).
