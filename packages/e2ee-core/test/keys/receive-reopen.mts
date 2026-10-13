import { parentPort, workerData } from 'node:worker_threads';
import { Effect } from 'effect';
import { makeSqliteEpochReceiver, ReceiveError } from '@lody/e2ee-core/keys/host/receive/sqlite';
import { ContentError } from '../../src/errors';
import { envelopeFixture, recipientPair } from './fixture';
import { synthetic } from './protection-fixture';
const f = envelopeFixture(),
  pair = await recipientPair();
let sequence = 0;
function rpc<A>(operation: string, args: unknown[]): Promise<A> {
  return new Promise<A>((resolve, reject) => {
    const id = ++sequence;
    const reply = (message: { id: number; ok: boolean; value: A }) => {
      if (message.id !== id) return;
      parentPort!.off('message', reply);
      if (message.ok) resolve(message.value);
      else reject(new Error('test-rpc-failed'));
    };
    parentPort!.on('message', reply);
    parentPort!.postMessage({ kind: 'request', id, operation, args });
  });
}
try {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const receiver = yield* makeSqliteEpochReceiver({
          path: workerData.journal,
          mode: 'open',
          genesis: f.context.genesis,
          signer: {
            publicKey: f.phone.publicKey,
            sign: () => Effect.fail(new ContentError({ code: 'sign-failed' })),
          },
          pair,
          ledger: f.ledger,
          keyStore: { path: workerData.keys, mode: 'open', protector: synthetic().protector },
          remote: {
            status: (slot) =>
              Effect.tryPromise({
                try: () =>
                  rpc<{
                    genesis: string;
                    epoch: number;
                    recipient: string;
                    revision: number;
                    status: string;
                  }>('status', [slot]),
                catch: () => new ReceiveError({ code: 'storage' }),
              }),
            report: (bytes, publication) =>
              Effect.tryPromise({
                try: () => rpc<void>('report', [bytes, publication]),
                catch: () => new ReceiveError({ code: 'storage' }),
              }),
          },
        });
        return { batch: yield* receiver.flushReports(), results: yield* receiver.results() };
      })
    )
  );
  parentPort!.postMessage({ kind: 'done', result });
} catch (error) {
  parentPort!.postMessage({
    kind: 'failed',
    category: error instanceof ReceiveError ? error.code : 'unexpected',
  });
  process.exitCode = 1;
}
