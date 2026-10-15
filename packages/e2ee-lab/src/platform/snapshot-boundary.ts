import Database from 'better-sqlite3';
import { isAbsolute } from 'node:path';
import { Effect } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { LabContentGatewayError } from './content-gateway';

/** Lab adapter for the locked sqlite-riverrun 0.3.0 storage schema. It observes
 * actual stored record boundaries without reading content or changing retention.
 * The request token is compared exactly with tokens emitted by this backend;
 * it is never parsed as a number or used to order positions. */
export const makeLabRiverrunSnapshotBoundary = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly genesis: Bytes.GenesisHash;
  readonly model: 'loro' | 'flock';
}) {
  const path = input.path,
    model = input.model,
    genesis = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  if (!isAbsolute(path) || !['loro', 'flock'].includes(model))
    return yield* new LabContentGatewayError({ status: 400 });
  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new Database(path, { readonly: true, fileMustExist: true }),
      catch: () => new LabContentGatewayError({ status: 502 }),
    }),
    (owned) => Effect.sync(() => owned.close())
  );
  const org = Buffer.from(genesis.toBytes()).toString('hex');
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    })
  );
  return (offset: string) =>
    Effect.try({
      try: () => {
        if (closed) throw new Error('closed');
        const row = db
          .prepare(`
          SELECT 1 AS valid FROM streams AS s
          WHERE s.bucket_id = ? AND s.stream_id = ? AND s.next_offset >= 0
            AND (printf('%020d', 0) = ? OR EXISTS (
              SELECT 1 FROM entries AS e WHERE e.stream_id_fk = s.id AND (
                (e.start_offset >= 0 AND e.start_offset <= s.next_offset
                  AND printf('%020d', e.start_offset) = ?)
                OR (e.end_offset >= 0 AND e.end_offset <= s.next_offset
                  AND printf('%020d', e.end_offset) = ?)
              )
            ))
          LIMIT 1
        `)
          .get(org, model, offset, offset, offset);
        return row !== undefined;
      },
      catch: () => new LabContentGatewayError({ status: 502 }),
    });
});
