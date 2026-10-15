import { openSqliteStore } from '../storage/sqlite';
import { isAbsolute } from 'node:path';
import { Effect, Layer } from 'effect';
import { DeliveryOutbox, DeliveryError } from './delivery';

const APP = 0x4c454f31;
const validSlot = (slot: string) => /^[0-9a-f]{32}$/.test(slot);
/** Dedicated ciphertext-only SQLite file, owned and closed by the application Scope. */
export function sqliteDeliveryOutbox(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
}) {
  const { path, mode } = input;
  return Layer.effect(
    DeliveryOutbox,
    Effect.gen(function* () {
      if (typeof path !== 'string' || !isAbsolute(path) || (mode !== 'create' && mode !== 'open'))
        return yield* new DeliveryError({ code: 'storage' });
      const db = yield* openSqliteStore({
        path,
        mode,
        applicationId: APP,
        version: 1,
        initialize(connection) {
          connection.exec(
            `CREATE TABLE epoch_delivery (slot TEXT PRIMARY KEY, frame BLOB NOT NULL CHECK(length(frame) BETWEEN 1 AND 512)); `
          );
        },
        error: (code) => new DeliveryError({ code }),
      });
      let closed = false;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
        })
      );

      const checked = <A>(slot: string, work: () => A) =>
        Effect.suspend(() => {
          if (closed) return Effect.fail(new DeliveryError({ code: 'closed' }));
          if (!validSlot(slot)) return Effect.fail(new DeliveryError({ code: 'invalid-slot' }));
          return Effect.try({
            try: work,
            catch: (error) =>
              error instanceof DeliveryError ? error : new DeliveryError({ code: 'storage' }),
          });
        });
      const read = (slot: string) => {
        const row = db
          .prepare(
            'SELECT CASE WHEN length(frame) BETWEEN 1 AND 512 THEN frame ELSE NULL END AS frame FROM epoch_delivery WHERE slot=?'
          )
          .get(slot) as { frame: unknown } | undefined;
        if (!row) return null;
        if (!(row.frame instanceof Uint8Array)) throw new DeliveryError({ code: 'corrupt' });
        return new Uint8Array(row.frame);
      };
      return DeliveryOutbox.of({
        load: (slot) => checked(slot, () => read(slot)),
        saveOriginal: (slot, inputFrame) =>
          Effect.suspend(() => {
            if (
              !(inputFrame instanceof Uint8Array) ||
              inputFrame.length < 1 ||
              inputFrame.length > 512
            )
              return Effect.fail(new DeliveryError({ code: 'corrupt' }));
            const frame = new Uint8Array(inputFrame);
            return checked(slot, () =>
              db
                .transaction(() => {
                  db.prepare(
                    'INSERT INTO epoch_delivery(slot,frame) VALUES(?,?) ON CONFLICT(slot) DO NOTHING'
                  ).run(slot, frame);
                  const original = read(slot);
                  if (!original) throw new DeliveryError({ code: 'corrupt' });
                  return original;
                })
                .immediate()
            );
          }),
      });
    })
  );
}
