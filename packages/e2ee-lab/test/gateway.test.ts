import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { join } from 'node:path';
import { Effect, Exit, Fiber, Result, Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { Bytes } from '@lody/e2ee-core';
import { hashRecordBytes, type LedgerView } from '@lody/e2ee-core/ledger';
import {
  prepareDeviceAdmission,
  prepareJoinRequest,
  prepareLedgerCommand,
} from '@lody/e2ee-core/ledger/admission';
import type { LedgerSubmissionStream } from '@lody/e2ee-core/submission/streams';
import { authorizeLabStream } from '../src/platform/gateway';
import { makeLabControlGateway } from '../src/platform/control-gateway';
import { makeLedgerStreamReader } from '@lody/e2ee-core/ledger/feed';
import { signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { makeLabLedgerActor } from '../src/platform/ledger-actor';
import { fixture, options, history } from './ledger-fixture';
const ok = Result.getOrThrow;
function syntheticSigner(seed: number) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, seed),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKey: ok(
      Bytes.signingPublicKey(
        new Uint8Array(
          createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
        )
      )
    ),
    sign: (message: Uint8Array) =>
      Effect.sync(() => ok(Bytes.signature(new Uint8Array(sign(null, message, privateKey))))),
  };
}
describe('genuine ledger Lab gateway policy (HTTP authentication not implemented here)', () => {
  it('binds the request Org and refuses structural fake authority, outsider devices and unknown/mutating routes', () => {
    const f = history();
    const input = {
      view: f.view,
      authenticatedCredential: { device: f.owner.publicKey, genesis: f.anchor },
      requestGenesis: f.anchor,
      stream: 'loro',
      method: 'GET',
    };
    expect(ok(authorizeLabStream(input))).toEqual({ action: 'read' });
    expect(
      Result.isFailure(
        authorizeLabStream({
          ...input,
          authenticatedCredential: { device: syntheticSigner(86).publicKey, genesis: null },
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        authorizeLabStream({
          ...input,
          requestGenesis: ok(Bytes.genesisHash(new Uint8Array(32).fill(87))),
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        authorizeLabStream({
          ...input,
          authenticatedCredential: {
            ...input.authenticatedCredential,
            genesis: ok(Bytes.genesisHash(new Uint8Array(32).fill(87))),
          },
        })
      )
    ).toBe(true);
    const wrong = ok(Bytes.genesisHash(new Uint8Array(32).fill(87)));
    const counterfeitBound = {
      toBytes: () => wrong.toBytes(),
      equals: () => true,
    } as unknown as Bytes.GenesisHash;
    expect(
      Result.isFailure(
        authorizeLabStream({
          ...input,
          authenticatedCredential: { ...input.authenticatedCredential, genesis: counterfeitBound },
        })
      )
    ).toBe(true);
    const brokenRequest = {
      toBytes: () => {
        throw new Error('hostile getter');
      },
    } as unknown as Bytes.GenesisHash;
    expect(Result.isFailure(authorizeLabStream({ ...input, requestGenesis: brokenRequest }))).toBe(
      true
    );
    const forged = {
      genesis: f.anchor,
      inspectState: () => f.view.inspectState(),
    } as unknown as LedgerView;
    expect(Result.isFailure(authorizeLabStream({ ...input, view: forged }))).toBe(true);
    expect(Result.isFailure(authorizeLabStream({ ...input, method: 'DELETE' }))).toBe(true);
    expect(Result.isFailure(authorizeLabStream({ ...input, stream: 'unknown' }))).toBe(true);
    expect(
      ok(authorizeLabStream({ ...input, stream: 'keys', method: 'POST', sub: 'append-cas' }))
    ).toEqual({ action: 'keys-cas' });
  });
  it('uses real public admission, SDK CAS and durable feed for current Recovery/machine roles and revocation', async () => {
    const f = await fixture();
    try {
      const originals = [...f.records];
      const stream = {
        read: f.sdk.read.bind(f.sdk),
        appendCas: async (input: Parameters<LedgerSubmissionStream['appendCas']>[0]) => {
          const output = await f.sdk.appendCas(input);
          if (output.ok && output.result.kind === 'ok')
            originals.push(new Uint8Array(input.part.body.subarray(4)));
          return output;
        },
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const actor = yield* makeLabLedgerActor({
              ...options(f, 'create'),
              stream,
              journalPath: join(f.dir, 'gateway-pending.sqlite'),
              checkpoint: () =>
                Effect.sync(() => ({
                  head: hashRecordBytes(originals[originals.length - 1]!),
                  length: originals.length,
                })),
              signer: f.owner,
            });
            const recovery = syntheticSigner(88),
              machine = syntheticSigner(89);
            for (const [signer, kind, enc] of [
              [recovery, 'recovery', 90],
              [machine, 'machine', 91],
            ] as const) {
              const consent = yield* prepareDeviceAdmission({
                genesis: f.anchor,
                membershipId: f.membership,
                encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(enc))),
                kind,
                signer,
              });
              const result = yield* actor.execute(consent);
              expect(result.outcome).toBe('Committed');
              yield* actor.acknowledge(result);
            }
            const input = {
              view: (yield* actor.current()).view,
              authenticatedCredential: { device: recovery.publicKey, genesis: f.anchor },
              requestGenesis: f.anchor,
              stream: 'keys',
              method: 'GET',
            };
            expect(ok(authorizeLabStream(input))).toEqual({ action: 'read' });
            for (const streamName of ['control', 'keys', 'loro', 'flock']) {
              expect(
                Result.isFailure(
                  authorizeLabStream({
                    ...input,
                    stream: streamName,
                    method: 'POST',
                    sub: 'append-cas',
                  })
                )
              ).toBe(true);
            }
            expect(
              Result.isFailure(
                authorizeLabStream({ ...input, stream: 'loro', method: 'PUT', sub: 'snapshot' })
              )
            ).toBe(true);
            expect(
              ok(
                authorizeLabStream({
                  ...input,
                  authenticatedCredential: { device: machine.publicKey, genesis: f.anchor },
                  stream: 'loro',
                  method: 'POST',
                })
              )
            ).toEqual({ action: 'content-cas' });
            const guest = syntheticSigner(92);
            const request = yield* prepareJoinRequest({
              genesis: f.anchor,
              requestId: ok(Bytes.requestId(new Uint8Array(16).fill(93))),
              userId: ok(Bytes.userId(new Uint8Array(32).fill(94))),
              encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(95))),
              expiresAt: null,
              signer: guest,
            });
            const guestMembership = ok(Bytes.membershipId(new Uint8Array(16).fill(96)));
            const joined = yield* actor.execute({
              _tag: 'AdmitMember',
              membershipId: guestMembership,
              request,
            });
            expect(joined.outcome).toBe('Committed');
            yield* actor.acknowledge(joined);
            const setRole = yield* actor.execute({
              _tag: 'SetRole',
              membershipId: guestMembership,
              role: 'guest',
            });
            expect(setRole.outcome).toBe('Committed');
            yield* actor.acknowledge(setRole);
            const guestInput = {
              ...input,
              view: (yield* actor.current()).view,
              authenticatedCredential: { device: guest.publicKey, genesis: f.anchor },
            };
            expect(ok(authorizeLabStream(guestInput))).toEqual({ action: 'read' });
            expect(
              ok(authorizeLabStream({ ...guestInput, method: 'POST', sub: 'append-cas' }))
            ).toEqual({ action: 'keys-cas' });
            expect(
              Result.isFailure(
                authorizeLabStream({ ...guestInput, stream: 'loro', method: 'POST' })
              )
            ).toBe(true);
            const revoked = yield* actor.execute({
              _tag: 'RevokeDevice',
              target: recovery.publicKey,
            });
            expect(revoked.outcome).toBe('Committed');
            yield* actor.acknowledge(revoked);
            expect(
              Result.isFailure(
                authorizeLabStream({ ...input, view: (yield* actor.current()).view })
              )
            ).toBe(true);
          })
        )
      );
    } finally {
      await f.close();
    }
  });
});

describe('public submission consumer behind the Lab control gateway', () => {
  it('verifies the whole selected prefix, binds signer/Org and uses real SDK pinned CAS; failed candidates preserve the actual remote tail', async () => {
    const f = await fixture();
    try {
      const originals = [...f.records];
      const stream: LedgerSubmissionStream = {
        read: f.sdk.read.bind(f.sdk),
        appendCas: async (input) => {
          const result = await f.sdk.appendCas(input);
          if (result.ok && result.result.kind === 'ok')
            originals.push(new Uint8Array(input.part.body.subarray(4)));
          return result;
        },
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gateway = yield* makeLabControlGateway({
              genesis: f.anchor,
              stream,
              checkpoint: () =>
                Effect.sync(() => ({
                  head: hashRecordBytes(originals.at(-1)!),
                  length: originals.length,
                })),
              now: () => 0,
              budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
            });
            const extra = syntheticSigner(107);
            const command = yield* prepareDeviceAdmission({
              genesis: f.anchor,
              membershipId: f.membership,
              encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(108))),
              kind: 'personal',
              signer: extra,
            });
            const original = yield* signLedgerRecord(
              ok(prepareLedgerCommand(f.view, f.owner.publicKey, command)),
              f.owner
            );
            const request = {
              authenticatedCredential: { device: f.owner.publicKey, genesis: f.anchor },
              requestGenesis: f.anchor,
              record: original,
            };
            const bad = new Uint8Array(original);
            bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
            expect(
              Result.isFailure(yield* Effect.result(gateway.append({ ...request, record: bad })))
            ).toBe(true);
            expect(
              Result.isFailure(
                yield* Effect.result(
                  gateway.append({
                    ...request,
                    authenticatedCredential: { device: extra.publicKey, genesis: f.anchor },
                  })
                )
              )
            ).toBe(true);
            expect(
              Result.isFailure(
                yield* Effect.result(
                  gateway.append({
                    ...request,
                    requestGenesis: ok(Bytes.genesisHash(new Uint8Array(32).fill(109))),
                  })
                )
              )
            ).toBe(true);
            const reader = yield* makeLedgerStreamReader(f.sdk);
            expect((yield* reader.readAfter('-1')).records).toEqual(f.records);
            const result = yield* gateway.append(request);
            const after = yield* reader.readAfter('-1');
            expect(after.records).toEqual([...f.records, original]);
            expect(after.nextOffset).toBe(result.nextOffset);
            expect(Result.isFailure(yield* Effect.result(gateway.append(request)))).toBe(true);
            expect((yield* reader.readAfter('-1')).records).toEqual(after.records);
          })
        )
      );
    } finally {
      await f.close();
    }
  });
});

it('stops gateway admission, interrupts and awaits its actual SDK CAS operation before closing the earlier Riverrun owner', async () => {
  const f = await fixture();
  const latch = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const entered = latch(),
    release = latch();
  let rawSettled = false,
    closedEarly = false,
    closed = false;
  let gateway: Effect.Success<ReturnType<typeof makeLabControlGateway>>;
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Scope.make();
          yield* Scope.addFinalizer(
            child,
            Effect.promise(async () => {
              closedEarly = !rawSettled;
              await f.close();
              closed = true;
            })
          );
          const command = yield* prepareDeviceAdmission({
            genesis: f.anchor,
            membershipId: f.membership,
            encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(111))),
            kind: 'personal',
            signer: syntheticSigner(110),
          });
          const record = yield* signLedgerRecord(
            ok(prepareLedgerCommand(f.view, f.owner.publicKey, command)),
            f.owner
          );
          gateway = yield* makeLabControlGateway({
            genesis: f.anchor,
            budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
            now: () => 0,
            checkpoint: () => Effect.succeed(f.checkpoint),
            stream: {
              read: f.sdk.read.bind(f.sdk),
              appendCas: async (request) => {
                entered.resolve();
                await release.promise;
                try {
                  return await f.sdk.appendCas(request);
                } finally {
                  rawSettled = true;
                }
              },
            },
          }).pipe(Effect.provideService(Scope.Scope, child));
          const request = {
            authenticatedCredential: { device: f.owner.publicKey, genesis: f.anchor },
            requestGenesis: f.anchor,
            record,
          };
          const worker = yield* Effect.forkChild(Effect.result(gateway.append(request)));
          yield* Effect.addFinalizer(() => Effect.sync(release.resolve));
          yield* Effect.promise(() => entered.promise);
          const closing = yield* Effect.forkChild(Scope.close(child, Exit.void), {
            startImmediately: true,
          });
          // Observe close through a separate current-admission probe, not microtask counts.
          const denied = yield* Effect.result(gateway.append(request));
          expect(Result.isFailure(denied)).toBe(true);
          const pending = closing.pollUnsafe();
          release.resolve();
          yield* Fiber.join(closing);
          expect(closedEarly).toBe(false);
          expect(closed).toBe(true);
          expect(rawSettled).toBe(true);
          expect(pending).toBeUndefined();
          expect(Result.isFailure(yield* Fiber.join(worker))).toBe(true);
        })
      )
    );
  } finally {
    release.resolve();
    if (!closed) await f.close();
  }
});
