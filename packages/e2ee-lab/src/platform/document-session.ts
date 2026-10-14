import { Data, Deferred, Effect, Exit, Result, Scope, Semaphore } from 'effect';

import {
  StreamsCrdt,
  type JsonObject,
  type CrdtAdapter,
  type RemoteCursor,
  type RemoteCursorStore,
  type TransportError,
} from '@loro-dev/streams-crdt';
import type { makeStreamsUpdateBinding } from '@lody/e2ee-core/content/streams';
import { makeLabUpdateProvider } from './content-provider';
import { makeLabDocumentStore } from './document-sqlite';
import { makeLabSdkOwner } from './sdk-owner';

export interface LabNativeDocument<TVersion extends JsonObject> {
  adapter(): CrdtAdapter<TVersion>;
  exportSnapshot(): Uint8Array;
  importSnapshot(bytes: Uint8Array): void;
  append(text: string): void;
  text(): string;
  release(): void;
}
export class LabContentError extends Data.TaggedError('LabContentError')<{
  readonly code:
    | 'closed'
    | 'document-stopped'
    | 'storage'
    | 'native'
    | 'transport'
    | TransportError['code']
    | import('@loro-dev/streams-crdt').PayloadProtectionFailureReason;
  readonly cause?: unknown;
}> {}
const sdkError = (cause: TransportError) =>
  error(cause.code === 'payload_protection_error' ? cause.reason : cause.code, cause);
const error = (code: LabContentError['code'], cause?: unknown) =>
  new LabContentError({ code, cause });
/** One synthetic Lab document, two real SDK modes, one durable state/cursor pair.
 * Failure stops this document only. Recovery explicitly reloads its durable native
 * state and replays encrypted history from -1; no snapshot writer/compatibility choice. */
export function makeLabDocumentSession<TVersion extends JsonObject>(
  input: Parameters<typeof makeStreamsUpdateBinding>[0] & {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly streamUrl: string;
    readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  },
  createNative: () => LabNativeDocument<TVersion>
) {
  return Effect.gen(function* () {
    const path = input.path,
      mode = input.mode,
      streamUrl = input.streamUrl;
    const nativeFetch = input.fetch;
    let closed = false,
      stopped = false;
    const active = new Set<Deferred.Deferred<void>>();
    const owners = new Set<{ stop(): Effect.Effect<void> }>();
    const serial = yield* Semaphore.make(1);
    const guard = (): Effect.Effect<void, LabContentError> =>
      closed ? Effect.fail(error('closed')) : Effect.void;
    const lookup = input.ledger;
    const provider = yield* makeLabUpdateProvider({
      ...input,
      model: input.model,
      ledger: () => guard().pipe(Effect.flatMap(() => lookup())),
    });
    const store = yield* makeLabDocumentStore<TVersion>({
      path,
      mode,
      streamUrl,
      genesis: Buffer.from(input.genesis.toBytes()).toString('hex'),
      resource: input.resource,
      model: input.model,
    });
    const allocate = () =>
      Effect.acquireUseRelease(
        Scope.make(),
        (child) =>
          Effect.gen(function* () {
            const doc = yield* Effect.acquireRelease(Effect.sync(createNative), (value) =>
              Effect.sync(() => value.release())
            ).pipe(Effect.provideService(Scope.Scope, child));
            const bytes = yield* store.restore();
            if (bytes)
              yield* Effect.acquireUseRelease(
                Effect.succeed(bytes),
                (owned) =>
                  Effect.try({
                    try: () => doc.importSnapshot(owned),
                    catch: () => error('storage'),
                  }),
                (owned) => Effect.sync(() => owned.fill(0))
              );
            return { doc, child };
          }),
        (child, exit) => (Exit.isFailure(exit) ? Scope.close(child, Exit.void) : Effect.void)
      );
    let current = yield* allocate();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        for (const owner of owners) yield* owner.stop();
        for (const done of active) yield* Deferred.await(done);
        yield* Scope.close(current.child, Exit.void);
      })
    );
    const operation = <A, E, R>(work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* guard();
          const done = yield* Deferred.make<void>();
          active.add(done);
          return done;
        }),
        () => serial.withPermit(guard().pipe(Effect.flatMap(() => work))),
        (done) =>
          Effect.gen(function* () {
            active.delete(done);
            yield* Deferred.succeed(done, undefined);
          })
      );
    const useSdk = <A extends { readonly ok: boolean }>(
      replay: boolean,
      work: (sdk: StreamsCrdt<TVersion>) => Promise<A>,
      before: Effect.Effect<void, unknown> = Effect.void
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const doc = current.doc;
          const adapter = doc.adapter();
          let recoveredCursor: RemoteCursor<TVersion> | undefined;
          if (replay) yield* Effect.addFinalizer(() => store.discardStaged());
          const cursorStore: RemoteCursorStore<TVersion> = replay
            ? {
                // Ephemeral seed only: failure does not change the last durable pair.
                load: async () => ({
                  streamUrl,
                  nextOffset: '-1',
                  serverLowerBoundVersion: await adapter.emptyVersion(),
                  updatedAtMs: 0,
                }),
                save: async (cursor) => {
                  recoveredCursor = structuredClone(cursor);
                },
              }
            : store.cursorStore;
          const owner = yield* makeLabSdkOwner(
            ({ signal, assertOpen }) =>
              new StreamsCrdt<TVersion>({
                streamUrl,
                adapter,
                remoteCursorStore: cursorStore,
                beforeRemoteCursorSave: async () => {
                  assertOpen();
                  if (closed) throw error('closed');
                  const snapshot = doc.exportSnapshot();
                  try {
                    Result.getOrThrow(store.stage(snapshot));
                  } finally {
                    snapshot.fill(0);
                  }
                },
                fetch: async (url, init) => {
                  const combined = init?.signal ? AbortSignal.any([init.signal, signal]) : signal;
                  const response = await nativeFetch(url, { ...init, signal: combined });
                  try {
                    assertOpen();
                  } catch (cause) {
                    await response.body?.cancel();
                    throw cause;
                  }
                  return response;
                },
                payloadProtectionRequired: true,
                e2ee: { provider, readPolicy: 'encrypted-only', writePolicy: 'encrypt' },
                snapshotUpload: { enabled: false, canUpload: () => false },
              })
          );
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              owners.add(owner);
            }),
            () =>
              Effect.sync(() => {
                owners.delete(owner);
              })
          );
          yield* before;
          const result = yield* owner
            .invoke(work)
            .pipe(Effect.onExit(() => provider.checkFailure()));
          if (replay && result.ok && recoveredCursor) {
            yield* guard();
            yield* Effect.tryPromise({
              try: () => store.cursorStore.save(recoveredCursor!),
              catch: () => error('storage'),
            });
          }
          return result;
        })
      );
    const live = (): Effect.Effect<void, LabContentError> =>
      stopped ? Effect.fail(error('document-stopped')) : guard();
    const execute = <A, E, R>(work: Effect.Effect<A, E, R>) =>
      operation(
        work.pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.sync(() => {
                  stopped = true;
                })
              : Effect.void
          )
        )
      );
    return Object.freeze({
      create: () =>
        execute(
          Effect.gen(function* () {
            yield* live();
            const result = yield* useSdk(false, (sdk) => sdk.createStream());
            if (!result.ok) yield* sdkError(result.error);
          })
        ),
      append: (text: string) =>
        execute(
          Effect.gen(function* () {
            yield* live();
            const result = yield* useSdk(
              false,
              (sdk) => sdk.appendWriteOnly(),
              Effect.gen(function* () {
                yield* Effect.try({
                  try: () => {
                    const doc = current.doc;
                    doc.append(text);
                  },
                  catch: () => error('native'),
                });
                yield* Effect.acquireUseRelease(
                  Effect.sync(() => current.doc.exportSnapshot()),
                  (bytes) => store.persistLocal(bytes),
                  (bytes) => Effect.sync(() => bytes.fill(0))
                );
              })
            );
            if (!result.ok) yield* sdkError(result.error);
          })
        ),
      persist: () =>
        execute(
          Effect.gen(function* () {
            yield* live();
            yield* Effect.acquireUseRelease(
              Effect.sync(() => current.doc.exportSnapshot()),
              (bytes) => store.persistLocal(bytes),
              (bytes) => Effect.sync(() => bytes.fill(0))
            );
          })
        ),
      pull: () =>
        execute(
          Effect.gen(function* () {
            yield* live();
            const result = yield* useSdk(false, (sdk) => sdk.catchup());
            if (!result.ok) yield* sdkError(result.error);
          })
        ),
      /** Explicit client recovery; preserves durable local edits, never deletes/changes host snapshots. */
      recoverFromFullHistory: () =>
        execute(
          Effect.gen(function* () {
            yield* guard();
            yield* Scope.close(current.child, Exit.void);
            current = yield* allocate();
            const result = yield* useSdk(true, (sdk) => sdk.catchup());
            if (!result.ok) yield* sdkError(result.error);
            stopped = false;
          })
        ),
      text: () =>
        operation(
          Effect.gen(function* () {
            yield* live();
            return current.doc.text();
          })
        ),
      cursor: () => operation(store.inspectCursor()),
      status: () =>
        Effect.sync(() =>
          closed
            ? ('closed' as const)
            : stopped
              ? ('document-stopped' as const)
              : ('active' as const)
        ),
    });
  });
}
