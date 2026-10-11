import { Effect, Semaphore } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import type { LedgerCheckpoint } from '@lody/e2ee-core/ledger';
import { makeLedgerStreamReader, type LedgerStreamReader } from '@lody/e2ee-core/ledger/feed';
import { makeSqliteLedgerFeed } from '@lody/e2ee-core/ledger/feed/sqlite';

/** A scoped Lab client of public modules. Transport is borrowed; checkpoint
 * authority is supplied independently for each read. No private core or runtime. */
export function makeLabLedgerClient(
  input: Parameters<typeof makeSqliteLedgerFeed>[0] & { readonly stream: LedgerStreamReader }
) {
  return Effect.gen(function* () {
    const feed = yield* makeSqliteLedgerFeed(input);
    const reader = yield* makeLedgerStreamReader(input.stream);
    const serial = yield* Semaphore.make(1);
    return Object.freeze({
      current: feed.current,
      read: (expected: LedgerCheckpoint) =>
        Effect.gen(function* () {
          // Capture before waiting for another read; caller mutation cannot change
          // the selected endpoint while the borrowed SDK operation is outstanding.
          const checkpoint = {
            head: yield* Effect.fromResult(Bytes.recordHash(expected.head.toBytes())),
            length: expected.length,
          };
          return yield* serial.withPermit(
            Effect.gen(function* () {
              const before = yield* feed.current();
              const page = yield* reader.readAfter(before.offset);
              return yield* feed.accept(page, checkpoint);
            })
          );
        }),
    });
  });
}
