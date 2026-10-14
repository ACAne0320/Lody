import { labImplementationIdentity } from './evidence';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { makeLabScenarioFixture } from './scenario-fixture';
import { exportDevice } from './device';
import { makeLabProcessActor } from './process-actor';
import { executeLabActions, type LabAction } from './action-executor';
import { fingerprintOf } from '../pure/fingerprint';
import { worstVerdict } from '../pure/judge';
import { makeLabSdkOwner } from './sdk-owner';
export class LabScenarioError extends Data.TaggedError('LabScenarioError')<{
  readonly code: 'watchdog';
}> {}
const good = { ok: true } as const;
/** Finite shipped scenario, explicitly prepared existing workspace. No creation,
 * candidate publisher, vault/snapshot bootstrap or deterministic first sealing. */
export const existingWorkspaceActions: readonly LabAction[] = [
  { kind: 'start', actor: 'owner', mode: 'create', expect: good },
  { kind: 'start', actor: 'peer', mode: 'create', expect: good },
  { kind: 'call', actor: 'owner', operation: 'keys', expect: good },
  { kind: 'call', actor: 'peer', operation: 'keys', expect: good },
  { kind: 'call', actor: 'owner', operation: 'create', document: 'loro', expect: good },
  { kind: 'call', actor: 'owner', operation: 'create', document: 'flock', expect: good },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'append',
    document: 'loro',
    text: 'synthetic hello',
    expect: good,
  },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'append',
    document: 'flock',
    text: 'synthetic flock',
    expect: good,
  },
  { kind: 'persist', actor: 'owner', document: 'loro', expect: good },
  { kind: 'call', actor: 'peer', operation: 'pull', document: 'loro', expect: good },
  { kind: 'call', actor: 'peer', operation: 'pull', document: 'flock', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, text: 'synthetic hello' },
  },
  { kind: 'crash', actor: 'owner', expect: good },
  { kind: 'start', actor: 'owner', mode: 'open', expect: good },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, text: 'synthetic hello' },
  },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'observe',
    document: 'flock',
    expect: { ok: true, text: 'synthetic flock' },
  },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'append',
    document: 'loro',
    text: ' resumed',
    expect: good,
  },
  { kind: 'attack', actor: 'peer', attack: 'corrupt-loro', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'pull',
    document: 'loro',
    expect: { ok: false, refusal: { tag: 'LabContentError', code: 'decrypt_failed' } },
  },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, unchangedFrom: 11 },
  },
  { kind: 'call', actor: 'peer', operation: 'pull', document: 'flock', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'flock',
    expect: { ok: true, text: 'synthetic flock' },
  },
  { kind: 'attack', actor: 'peer', attack: 'clear', expect: good },
  { kind: 'call', actor: 'peer', operation: 'recover', document: 'loro', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, text: 'synthetic hello resumed' },
  },
  { kind: 'attack', actor: 'peer', attack: 'deny-loro-persist', expect: good },
  {
    kind: 'persist',
    actor: 'peer',
    document: 'loro',
    expect: { ok: false, refusal: { tag: 'LabDocumentError', code: 'sqlite' } },
  },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, unchangedFrom: 24 },
  },
  { kind: 'attack', actor: 'peer', attack: 'restore-loro-persist', expect: good },
  { kind: 'call', actor: 'peer', operation: 'recover', document: 'loro', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'observe',
    document: 'loro',
    expect: { ok: true, text: 'synthetic hello resumed' },
  },
  { kind: 'attack', actor: 'owner', attack: 'drop-control-ack', expect: good },
  {
    kind: 'call',
    actor: 'owner',
    operation: 'revoke-peer',
    expect: { ok: false, refusal: { tag: 'LabTransportFault', code: 'dropped-committed-ack' } },
  },
  { kind: 'crash', actor: 'owner', expect: good },
  { kind: 'start', actor: 'owner', mode: 'open', expect: good },
  { kind: 'call', actor: 'owner', operation: 'resume', expect: { ok: true, outcome: 'Committed' } },
  { kind: 'call', actor: 'owner', operation: 'refresh', expect: good },
  { kind: 'call', actor: 'owner', operation: 'acknowledge', expect: good },
  {
    kind: 'call',
    actor: 'peer',
    operation: 'refresh',
    expect: { ok: false, refusal: { tag: 'LedgerFeedError', code: 'forbidden' } },
  },
];
/** Complete actor execution + bounded artifacts. Expected text and old durable
 * bytes are independent reference observations, not production permissions.
 * Raw signed ledger and encrypted SQL outbox frames retain original bytes.
 * Secret fixture exports stay private IPC memory and do not enter evidence.json. */
export const runLabScenario = Effect.fn('Lab.runScenario')(function* (input: {
  readonly directory: string;
  readonly actions?: readonly unknown[];
  readonly maxSteps?: number;
  readonly stop?: Effect.Effect<void>;
}) {
  const directory = input.directory,
    actions = input.actions ?? existingWorkspaceActions,
    maxSteps = input.maxSteps ?? 256,
    stop = input.stop;
  const completed = yield* Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makeLabScenarioFixture(join(directory, 'fixture'));
      const ownerFixture = yield* exportDevice(fixture.owner),
        peerFixture = yield* exportDevice(fixture.peer);
      const actors: Record<string, Effect.Success<ReturnType<typeof makeLabProcessActor>>> = {};
      for (const label of ['owner', 'peer'] as const)
        actors[label] = yield* makeLabProcessActor((mode) =>
          Effect.sync(() => ({
            syntheticOnly: true as const,
            peerSigningKey: Buffer.from(fixture.peer.publicKey.toBytes()).toString('hex'),
            device: label === 'owner' ? ownerFixture : peerFixture,
            baseUrl: fixture.host.baseUrl,
            directory: fixture.directory,
            actor: label,
            mode,
            genesis: Buffer.from(fixture.genesis.toBytes()).toString('hex'),
            records: fixture.records.map((record) => Buffer.from(record).toString('hex')),
            point: {
              head: Buffer.from(fixture.point().head.toBytes()).toString('hex'),
              length: fixture.point().length,
            },
          }))
        );
      const implementation = yield* Effect.try({
        try: labImplementationIdentity,
        catch: (cause) => cause,
      });
      const run = yield* executeLabActions({ actors, actions, maxSteps, stop });
      const evidenceTransport = yield* makeLabSdkOwner(() => ({ close: async () => undefined }));
      const ciphertext = [];
      const org = Buffer.from(fixture.genesis.toBytes()).toString('hex');
      for (const stream of ['loro', 'flock']) {
        const saved = yield* evidenceTransport.invoke(async () => {
          const response = await fetch(`${fixture.server.baseUrl}/ds/${org}/${stream}?offset=-1`, {
            signal: evidenceTransport.signal,
          });
          const reader = response.body?.getReader(),
            chunks: Uint8Array[] = [];
          let length = 0;
          try {
            if (reader)
              for (;;) {
                const item = await reader.read();
                if (item.done) break;
                length += item.value.length;
                if (length > 16 * 1024 * 1024) throw new Error('evidence-stream-budget');
                chunks.push(item.value);
              }
          } finally {
            if (reader) {
              await reader.cancel();
              reader.releaseLock();
            }
          }
          const bytes = new Uint8Array(length);
          let at = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.length;
          }
          return {
            stream,
            status: response.status,
            bodyHex: Buffer.from(bytes).toString('hex'),
            sha256: createHash('sha256').update(bytes).digest('hex'),
            contentType: response.headers.get('content-type'),
            nextOffset: response.headers.get('stream-next-offset'),
          };
        });
        ciphertext.push(saved);
      }
      const report = {
        integrity: worstVerdict(run.observations.map((row) => row.integrity)),
        durability: worstVerdict(
          run.observations
            .filter((row) => row.durability !== 'unavailable')
            .map((row) => row.durability)
        ),
        confidentiality: 'unavailable' as const,
      };
      const artifacts = {
        version: 1,
        syntheticOnly: true,
        scope: 'existing-workspace finite action execution',
        identity: {
          owner: Buffer.from(fixture.owner.publicKey.toBytes()).toString('hex'),
          peer: Buffer.from(fixture.peer.publicKey.toBytes()).toString('hex'),
        },
        implementation,
        ciphertext,
        rawTransportFiles: ['fixture/owner-transport.jsonl', 'fixture/peer-transport.jsonl'],
        originals: fixture.records.map((record) => ({
          hex: Buffer.from(record).toString('hex'),
          sha256: createHash('sha256').update(record).digest('hex'),
        })),
        run,
        report,
        fingerprint: fingerprintOf(report),
        limits: [
          'No exact-ciphertext regeneration/replay entropy approval',
          'Confidentiality/insider scan unmeasured',
          'No production/native custody',
          'No genesis publication/candidate rotation/vault/snapshot decision',
        ],
      };
      for (const actor of Object.values(actors)) yield* actor.shutdown();
      return artifacts;
    })
  ).pipe(
    // This harness watchdog interrupts the whole owned scenario. Its Scope joins
    // actual child SIGKILL/close and native body cleanup before returning failure.
    Effect.timeoutOrElse({
      duration: '120 seconds',
      orElse: () => Effect.fail(new LabScenarioError({ code: 'watchdog' })),
    })
  );
  // Publish final evidence only after successful scenario completion and owner
  // cleanup. A hung shutdown must not leave a pass artifact for inspect.
  yield* Effect.try({
    try: () => {
      const body = JSON.stringify(completed, null, 2) + '\n';
      writeFileSync(join(directory, 'evidence.json'), body, { mode: 0o600, flag: 'wx' });
      if (readFileSync(join(directory, 'evidence.json'), 'utf8') !== body)
        throw new Error('evidence-readback');
    },
    catch: (cause) => cause,
  });
  return completed;
});
