import { Effect, Option } from 'effect';
import type { Repo } from 'loro-repo/effect';
import { getSessionIdFromRoomId, getSessionRoomId, SESSION_DOC_PREFIX } from '../session-room-id';
import type { SessionMeta } from '../schema';
import {
  DataReadFailed,
  type SessionDirectoryQuery,
  selectSessionDirectoryRows,
} from './session-directory';
import { DataReadSyncFailed, type ReadSyncPolicy } from './sync-authority';

/** The native catalog is already shared by every borrower of this workspace Repo. */
export const makeSessionDirectory = (repo: Repo) => ({
  list: (query: SessionDirectoryQuery) =>
    repo.listDoc({ prefix: SESSION_DOC_PREFIX }).pipe(
      Effect.map((rows) =>
        selectSessionDirectoryRows(
          rows.flatMap((row) => {
            const id = getSessionIdFromRoomId(row.docId);
            return row.deleted || id === null ? [] : [{ ...row.meta, id } as SessionMeta];
          }),
          query
        )
      ),
      Effect.mapError((cause) => new DataReadFailed({ operation: 'session directory list', cause }))
    ),
  get: (id: Parameters<typeof getSessionRoomId>[0]) =>
    repo.getDocMeta(getSessionRoomId(id)).pipe(
      Effect.map((row) =>
        row && !row.deleted ? Option.some({ ...row.meta, id } as SessionMeta) : Option.none()
      ),
      Effect.mapError((cause) => new DataReadFailed({ operation: 'session directory get', cause }))
    ),
});

export const makeSyncAuthority = (
  repo: Repo,
  policy: { readonly local: boolean; readonly serverTransports: readonly string[] }
) => ({
  refresh: (request: ReadSyncPolicy) =>
    policy.local
      ? Effect.void
      : Effect.gen(function* () {
          const report = yield* repo.sync({
            scope: 'meta',
            requireTransports: policy.serverTransports,
            timeoutMs: request.timeoutMs,
          });
          if (report.outcome !== 'confirmed' || report.authority !== 'server')
            yield* Effect.fail(
              new DataReadSyncFailed({
                target: { kind: 'workspace-meta' },
                reason: request.reason,
                cause: report,
              })
            );
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof DataReadSyncFailed
              ? cause
              : new DataReadSyncFailed({
                  target: { kind: 'workspace-meta' },
                  reason: request.reason,
                  cause,
                })
          )
        ),
});
