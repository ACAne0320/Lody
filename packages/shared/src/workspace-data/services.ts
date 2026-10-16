import { Effect, Layer, Option } from 'effect';
import type { Repo } from 'loro-repo/effect';
import { getSessionIdFromRoomId, getSessionRoomId, SESSION_DOC_PREFIX } from '../session-room-id';
import type { SessionMeta } from '../schema';
import { DataReadFailed, SessionDirectory, selectSessionDirectoryRows } from './session-directory';
import { DataReadSyncFailed, SyncAuthority } from './sync-authority';

/** The native catalog is already shared by every borrower of this workspace Repo. */
export const makeSessionDirectory = (repo: Repo): typeof SessionDirectory.Service => ({
  list: (query) =>
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
  get: (id) =>
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
) =>
  SyncAuthority.of({
    refresh: (target, request) =>
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
                new DataReadSyncFailed({ target, reason: request.reason, cause: report })
              );
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof DataReadSyncFailed
                ? cause
                : new DataReadSyncFailed({ target, reason: request.reason, cause })
            )
          ),
  });

export const workspaceDataLayer = (repo: Repo, policy: Parameters<typeof makeSyncAuthority>[1]) =>
  Layer.merge(
    Layer.succeed(SessionDirectory, makeSessionDirectory(repo)),
    Layer.succeed(SyncAuthority, makeSyncAuthority(repo, policy))
  );
