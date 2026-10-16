import { Context, Data, type Effect, type Option } from 'effect';
import type { SessionId } from '../ids';
import type { SessionMeta } from '../schema';

/**
 * Which lifecycle the caller wants to see. There is no default: an omitted
 * filter meant "active only" to the CLI and "everything" to other callers.
 */
export type SessionDirectoryArchiveFilter = 'active' | 'archived' | 'any';

export type SessionDirectoryQuery = {
  readonly archive: SessionDirectoryArchiveFilter;
  /** Case-insensitive substring of the title or the Session id. */
  readonly text?: string;
  readonly machineId?: string;
  readonly agentConfigId?: string;
  readonly agentRoleId?: string;
  /** Exact opener (`openedBySessionId`), never the opener's root. */
  readonly openedBySessionId?: SessionId;
  readonly parentSessionId?: SessionId;
  /** Human owner (`SessionMeta.userId`). */
  readonly createdByUserId?: string;
  readonly limit?: number;
};

export class DataReadFailed extends Data.TaggedError('DataReadFailed')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * Workspace Session directory: metadata summaries only. Listing never opens a
 * Session body, activates an Agent or waits for cloud catch-up; callers that
 * need a fresh remote view ask `SyncAuthority.refresh` first.
 */
export class SessionDirectory extends Context.Service<
  SessionDirectory,
  {
    /**
     * Matching Sessions from one read of the local metadata index, most recent
     * activity first. Deleted Sessions are absent; archived ones follow `archive`.
     */
    list(query: SessionDirectoryQuery): Effect.Effect<readonly SessionMeta[], DataReadFailed>;
    /** One Session's metadata, or `None` when it is deleted or has none yet. */
    get(sessionId: SessionId): Effect.Effect<Option.Option<SessionMeta>, DataReadFailed>;
  }
>()('@lody/shared/workspace-data/SessionDirectory') {}

const includesFolded = (value: string | undefined, needle: string): boolean =>
  value?.toLowerCase().includes(needle) === true;

export function matchesSessionDirectoryQuery(
  session: SessionMeta,
  query: SessionDirectoryQuery
): boolean {
  if (query.archive === 'active' && session.isArchived === true) return false;
  if (query.archive === 'archived' && session.isArchived !== true) return false;
  if (query.text) {
    const needle = query.text.toLowerCase();
    if (!includesFolded(session.title, needle) && !includesFolded(session.id, needle)) {
      return false;
    }
  }
  return (
    (!query.machineId || session.machineId === query.machineId) &&
    (!query.agentConfigId || session.agentConfigId === query.agentConfigId) &&
    (!query.agentRoleId || session.agentRoleId === query.agentRoleId) &&
    (!query.openedBySessionId || session.openedBySessionId === query.openedBySessionId) &&
    (!query.parentSessionId || session.parentSessionId === query.parentSessionId) &&
    (!query.createdByUserId || session.userId === query.createdByUserId)
  );
}

/** Last message time, else creation time; an unparseable creation time sorts as 0. */
export function sessionRecentActivityAt(session: SessionMeta): number {
  if (session.lastMessageAt !== undefined) return session.lastMessageAt;
  const createdAt = Date.parse(session.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

/** Most recent activity first; ties fall back to descending id for a stable order. */
export function compareSessionsByRecentActivity(left: SessionMeta, right: SessionMeta): number {
  const difference = sessionRecentActivityAt(right) - sessionRecentActivityAt(left);
  return difference !== 0 ? difference : right.id.localeCompare(left.id);
}

/** The pure part of `SessionDirectory.list`, shared by every implementation. */
export function selectSessionDirectoryRows(
  sessions: Iterable<SessionMeta>,
  query: SessionDirectoryQuery
): SessionMeta[] {
  const selected: SessionMeta[] = [];
  for (const session of sessions) {
    if (matchesSessionDirectoryQuery(session, query)) selected.push(session);
  }
  selected.sort(compareSessionsByRecentActivity);
  return query.limit === undefined ? selected : selected.slice(0, query.limit);
}
