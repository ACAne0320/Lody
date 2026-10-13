import Database from 'better-sqlite3';
import { openSync, closeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import type { RemoteCursor, RemoteCursorStore, JsonObject } from '@loro-dev/streams-crdt';

export class LabDocumentError extends Data.TaggedError('LabDocumentError')<{
  readonly code: 'closed' | 'invalid-input' | 'sqlite' | 'corrupt' | 'missing-staged-document';
}> {}
const failure = (code: LabDocumentError['code']) => new LabDocumentError({ code });
const MAX_DOCUMENT = 64 * 1024 * 1024;
const MAX_CURSOR = 64 * 1024;
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
/** Synthetic Lab state only, never production database migration or key/recovery-vault storage.
 * Every document owns a separate file. SDK save atomically persists actual staged CRDT state
 * and its exact cursor, with in-transaction readback before success. No legacy JSON import. */
export function makeLabDocumentStore<TVersion extends JsonObject = JsonObject>(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: string;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  readonly streamUrl: string;
}) {
  return Effect.gen(function* () {
    const { path, mode, genesis, resource, model, streamUrl } = input;
    if (
      !isAbsolute(path) ||
      !/^[0-9a-f]{64}$/.test(genesis) ||
      !resource ||
      resource.length > 256 ||
      (model !== 'loro' && model !== 'flock') ||
      !streamUrl ||
      streamUrl.length > 4096 ||
      (mode !== 'create' && mode !== 'open')
    )
      return yield* failure('invalid-input');
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          if (mode === 'create') closeSync(openSync(path, 'wx', 0o600));
          return new Database(path, { fileMustExist: true });
        },
        catch: () => failure('sqlite'),
      }),
      (value) => Effect.sync(() => value.close())
    );
    let closed = false;
    let staged: Uint8Array | undefined;
    const protect = <A>(work: () => A) =>
      Result.try({
        try: () => {
          if (closed) throw failure('closed');
          return work();
        },
        catch: (cause) => (cause instanceof LabDocumentError ? cause : failure('sqlite')),
      });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        staged?.fill(0);
        staged = undefined;
      })
    );
    const meta = () => {
      const row = db
        .prepare('SELECT format,genesis,resource,model,url FROM lab_document_owner WHERE id=1')
        .get() as Record<string, unknown> | undefined;
      if (
        !row ||
        row.format !== 1 ||
        row.genesis !== genesis ||
        row.resource !== resource ||
        row.model !== model ||
        row.url !== streamUrl ||
        (db.prepare('SELECT count(*) AS n FROM lab_document_owner').get() as { n: number }).n !== 1
      )
        throw failure('corrupt');
    };
    yield* Effect.fromResult(
      protect(() => {
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = FULL');
        if (mode === 'create')
          db.transaction(() => {
            db.exec(
              'CREATE TABLE lab_document_owner(id INTEGER PRIMARY KEY CHECK(id=1),format INTEGER NOT NULL,genesis TEXT NOT NULL,resource TEXT NOT NULL,model TEXT NOT NULL,url TEXT NOT NULL); CREATE TABLE lab_document_state(id INTEGER PRIMARY KEY CHECK(id=1),document BLOB NOT NULL,cursor TEXT);'
            );
            db.prepare('INSERT INTO lab_document_owner VALUES(1,1,?,?,?,?)').run(
              genesis,
              resource,
              model,
              streamUrl
            );
            meta();
          })();
        else meta();
      })
    );
    const state = () => {
      meta();
      const row = db
        .prepare(
          `SELECT CASE WHEN length(document) BETWEEN 1 AND ${MAX_DOCUMENT} THEN document ELSE NULL END AS document, CASE WHEN cursor IS NULL OR length(cursor)<=${MAX_CURSOR} THEN cursor ELSE 'invalid' END AS cursor FROM lab_document_state WHERE id=1`
        )
        .get() as { document: unknown; cursor: unknown } | undefined;
      if (!row) return undefined;
      if (
        !(row.document instanceof Uint8Array) ||
        (row.cursor !== null && typeof row.cursor !== 'string')
      )
        throw failure('corrupt');
      return { document: new Uint8Array(row.document), cursor: row.cursor as string | null };
    };
    const cursor = (text: string): RemoteCursor<TVersion> => {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object') throw failure('corrupt');
      const c = value as RemoteCursor<TVersion>;
      if (
        c.streamUrl !== streamUrl ||
        typeof c.nextOffset !== 'string' ||
        !c.nextOffset ||
        c.nextOffset.length > 1024 ||
        c.nextOffset === 'now' ||
        !Number.isSafeInteger(c.updatedAtMs) ||
        c.updatedAtMs < 0 ||
        !c.serverLowerBoundVersion ||
        typeof c.serverLowerBoundVersion !== 'object' ||
        Array.isArray(c.serverLowerBoundVersion)
      )
        throw failure('corrupt');
      return c;
    };
    const write = (document: Uint8Array, value: string | null) =>
      db.transaction(() => {
        meta();
        db.prepare(
          'INSERT INTO lab_document_state(id,document,cursor) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,cursor=excluded.cursor'
        ).run(document, value);
        const after = state();
        if (!after || !same(after.document, document) || after.cursor !== value)
          throw failure('corrupt');
        if (
          (db.prepare('SELECT count(*) AS n FROM lab_document_state').get() as { n: number }).n !==
          1
        )
          throw failure('corrupt');
      })();
    const own = (bytes: Uint8Array) => {
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_DOCUMENT)
        throw failure('invalid-input');
      return new Uint8Array(bytes);
    };
    const cursorStore = Object.freeze({
      async load(url) {
        return Result.getOrThrow(
          protect(() => {
            if (url !== streamUrl) throw failure('invalid-input');
            const row = state();
            return row?.cursor ? cursor(row.cursor) : null;
          })
        );
      },
      async save(value) {
        Result.getOrThrow(
          protect(() => {
            if (!staged) throw failure('missing-staged-document');
            const text = JSON.stringify(value);
            if (text.length > MAX_CURSOR) throw failure('invalid-input');
            cursor(text);
            write(staged, text);
            staged.fill(0);
            staged = undefined;
          })
        );
      },
    } satisfies RemoteCursorStore<TVersion>);
    return Object.freeze({
      cursorStore,
      discardStaged: () =>
        Effect.sync(() => {
          staged?.fill(0);
          staged = undefined;
        }),
      restore: () =>
        Effect.suspend(() => Effect.fromResult(protect(() => state()?.document ?? null))),
      persistLocal: (bytes: Uint8Array) =>
        Effect.suspend(() =>
          Effect.fromResult(
            protect(() => {
              const owned = own(bytes);
              try {
                write(owned, state()?.cursor ?? null);
              } finally {
                owned.fill(0);
              }
            })
          )
        ),
      /** SDK pre-save callback boundary; owned actual snapshot, not an injected persistence assertion. */
      stage: (bytes: Uint8Array) =>
        protect(() => {
          const next = own(bytes);
          staged?.fill(0);
          staged = next;
        }),
      inspectCursor: () =>
        Effect.suspend(() =>
          Effect.fromResult(
            protect(() => {
              const row = state();
              return row?.cursor ? cursor(row.cursor) : null;
            })
          )
        ),
    });
  });
}
