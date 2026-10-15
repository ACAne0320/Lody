import { labImplementationIdentity } from './evidence';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { makeLabScenarioFixture } from './scenario-fixture';
import { exportDevice } from './device';
import { makeLabProcessActor } from './process-actor';
import { executeLabActions, summarizeLabActions, type LabAction } from './action-executor';
import { fingerprintOf } from '../pure/fingerprint';
import { makeLabSdkOwner } from './sdk-owner';
import { readBoundedBody } from './bounded-body';
import type { ScheduleChoice } from '../pure/schedule';
import { refStateFromOrg, refWriteExpectation } from '../pure/reference-model';
import { makeLabContentTrace } from './content-trace';
import { makeLabAttackObserver } from './attack-observer';
import { judgeWriteObservation, worstVerdict } from '../pure/judge';
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
  readonly schedule?: readonly ScheduleChoice[];
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
      const org = Buffer.from(fixture.genesis.toBytes()).toString('hex');
      const trace = yield* makeLabContentTrace({ maxFacts: 256, maxTextBytes: 1024 * 1024 });
      const writerMeasurements: {
        action: number;
        expected: 'allow' | 'deny' | 'unmeasured';
        accepted: boolean;
        refusal?: { readonly tag: string; readonly code: string };
      }[] = [];
      let observedActions = 0;
      const run = yield* executeLabActions({
        actors,
        actions,
        maxSteps,
        stop,
        schedule: input.schedule,
        onObservation: (observation) =>
          Effect.gen(function* () {
            const action = observation.action;
            const index = observedActions++;
            if (action.kind !== 'call' || action.operation !== 'append') return;
            const device =
              action.actor === 'owner' ? fixture.owner.publicKey : fixture.peer.publicKey;
            const deviceHex = Buffer.from(device.toBytes()).toString('hex');
            // Facts come from independently witnessed original host records, not
            // from the child or the implementation's write-permission function.
            const facts = refStateFromOrg(org, fixture.view().inspectState());
            const expected = refWriteExpectation(facts, deviceHex, org, facts.epoch);
            writerMeasurements.push({
              action: index,
              expected,
              accepted: observation.reply.ok,
              refusal: observation.reply.error,
            });
            if (observation.reply.ok)
              yield* trace.recordContentWrite({
                genesisHex: org,
                stream: action.document!,
                deviceHex,
                epoch: facts.epoch,
                text: action.text!,
                writerMayWrite: expected === 'unmeasured' ? undefined : expected === 'allow',
              });
          }),
      });
      const evidenceTransport = yield* makeLabSdkOwner(() => ({ close: async () => undefined }));
      const ciphertext: {
        stream: string;
        status: number;
        bodyHex: string;
        sha256: string;
        contentType: string | null;
        nextOffset: string | null;
        upToDate: boolean;
      }[] = [];
      for (const stream of ['loro', 'flock']) {
        const saved = yield* evidenceTransport.invoke(async () => {
          const response = await fetch(`${fixture.server.baseUrl}/ds/${org}/${stream}?offset=-1`, {
            signal: evidenceTransport.signal,
          });
          const bytes = response.body
            ? await readBoundedBody(response.body, 16 * 1024 * 1024)
            : new Uint8Array();
          if (bytes === undefined) throw new Error('evidence-stream-budget');
          return {
            stream,
            status: response.status,
            bodyHex: Buffer.from(bytes).toString('hex'),
            sha256: createHash('sha256').update(bytes).digest('hex'),
            contentType: response.headers.get('content-type'),
            nextOffset: response.headers.get('stream-next-offset'),
            upToDate: response.headers.get('stream-up-to-date') === 'true',
          };
        });
        ciphertext.push(saved);
      }
      const attackObserver = yield* makeLabAttackObserver({
        genesis: fixture.genesis,
        backend: {
          read: () =>
            Effect.try({
              try: () => {
                if (ciphertext.some((row) => row.status !== 200 || !row.upToDate))
                  throw new Error('Incomplete backend byte observations');
                return ciphertext.map((row) => new Uint8Array(Buffer.from(row.bodyHex, 'hex')));
              },
              catch: (cause) => cause,
            }),
        },
        ledger: fixture.ledger,
        trace,
      });
      const measured = yield* attackObserver.observe();
      const { integrity, durability } = summarizeLabActions(run.observations);
      const writers = worstVerdict(writerMeasurements.map(judgeWriteObservation));
      const report = {
        integrity: worstVerdict([integrity, writers]),
        durability,
        confidentiality: measured.report.confidentiality,
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
        measurements: { writerMeasurements, attacks: measured },
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
