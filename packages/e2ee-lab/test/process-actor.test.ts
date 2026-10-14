import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { makeLabScenarioFixture } from '../src/platform/scenario-fixture';
import { makeLabProcessActor } from '../src/platform/process-actor';
import { exportDevice } from '../src/platform/device';
it('hard kills a real actor after protected writes, restarts with independent pins and original installed keys without reinstalling a historical envelope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-process-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const ownerFixture = yield* exportDevice(f.owner),
            peerFixture = yield* exportDevice(f.peer);
          const actor = (label: 'owner' | 'peer') =>
            makeLabProcessActor((mode) =>
              Effect.sync(() => ({
                syntheticOnly: true as const,
                peerSigningKey: Buffer.from(f.peer.publicKey.toBytes()).toString('hex'),
                device: label === 'owner' ? ownerFixture : peerFixture,
                baseUrl: f.host.baseUrl,
                directory: f.directory,
                actor: label,
                mode,
                genesis: Buffer.from(f.genesis.toBytes()).toString('hex'),
                records: f.records.map((record) => Buffer.from(record).toString('hex')),
                point: {
                  head: Buffer.from(f.point().head.toBytes()).toString('hex'),
                  length: f.point().length,
                },
              }))
            );
          const a = yield* actor('owner'),
            b = yield* actor('peer');
          const started = yield* a.start('create');
          expect(started.ok).toBe(true);
          const pid = a.pid();
          expect((yield* b.start('create')).ok).toBe(true);
          expect((yield* a.call('keys')).ok).toBe(true);
          expect((yield* b.call('keys')).ok).toBe(true);
          expect((yield* a.call('create', 'loro')).ok).toBe(true);
          expect((yield* a.call('create', 'flock')).ok).toBe(true);
          expect((yield* a.call('append', 'loro', 'OS original')).ok).toBe(true);
          expect((yield* a.call('append', 'flock', 'OS flock')).ok).toBe(true);
          expect((yield* b.call('pull', 'loro')).ok).toBe(true);
          const before = yield* a.call('observe', 'loro');
          expect(before.value).toMatchObject({ text: 'OS original', status: 'active' });
          const killed = yield* a.crash();
          expect(killed.signal).toBe('SIGKILL');
          expect((yield* a.start('open')).ok).toBe(true);
          expect(a.pid()).not.toBe(pid);
          const restored = yield* a.call('observe', 'loro');
          expect(restored.value).toEqual(before.value);
          expect((yield* a.call('observe', 'flock')).value).toMatchObject({ text: 'OS flock' });
          expect((yield* a.call('append', 'loro', ' reopened')).ok).toBe(true);
          expect((yield* a.call('append', 'flock', ' reopened')).ok).toBe(true);
          expect((yield* b.call('pull', 'flock')).ok).toBe(true);
          expect((yield* b.call('observe', 'flock')).value).toMatchObject({
            text: 'OS flock reopened',
          });
          expect((yield* b.call('pull', 'loro')).ok).toBe(true);
          expect((yield* b.call('observe', 'loro')).value).toMatchObject({
            text: 'OS original reopened',
          });
          yield* a.shutdown();
          yield* b.shutdown();
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
