import { Data, Effect, Schema } from 'effect';
import { makeLabRuntime } from './runtime';
import { driveLabPermits } from './driver';
import type { makeLabProcessActor, LabProcessReply } from './process-actor';
import { judgeClientDurability, worstVerdict, type JudgeVerdict } from '../pure/judge';
import type { ScheduleChoice } from '../pure/schedule';
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const Text = Schema.String.check(Schema.isMaxLength(4096));
const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Refusal = Schema.Struct({ tag: Text, code: Text });
const Expect = Schema.Struct({
  ok: Schema.Boolean,
  refusal: Schema.optional(Refusal),
  outcome: Schema.optional(Schema.Literals(['Committed', 'Conflicted'])),
  text: Schema.optional(Text),
  unchangedFrom: Schema.optional(Index),
});
const Base = { actor: Name, expect: Schema.optional(Expect) };
const Action = Schema.Union([
  Schema.Struct({
    ...Base,
    kind: Schema.Literal('start'),
    mode: Schema.Literals(['create', 'open']),
  }),
  Schema.Struct({
    ...Base,
    kind: Schema.Literal('call'),
    operation: Schema.Literals([
      'keys',
      'refresh',
      'resume',
      'create',
      'append',
      'pull',
      'recover',
      'observe',
      'revoke-peer',
      'acknowledge',
    ]),
    document: Schema.optional(Schema.Literals(['loro', 'flock'])),
    text: Schema.optional(Text),
  }),
  Schema.Struct({
    ...Base,
    kind: Schema.Literal('persist'),
    document: Schema.Literals(['loro', 'flock']),
  }),
  Schema.Struct({ ...Base, kind: Schema.Literal('crash') }),
  Schema.Struct({
    ...Base,
    kind: Schema.Literal('attack'),
    attack: Schema.Literals([
      'clear',
      'corrupt-loro',
      'drop-control-ack',
      'deny-loro-persist',
      'restore-loro-persist',
    ]),
  }),
]);
export type LabAction = typeof Action.Type;
export type LabActionActor = Effect.Success<ReturnType<typeof makeLabProcessActor>>;
export class LabActionError extends Data.TaggedError('LabActionError')<{
  readonly code: 'invalid-plan' | 'unknown-actor' | 'missing-observation';
}> {}
export interface LabActionObservation {
  readonly action: LabAction;
  readonly reply: LabProcessReply;
  readonly integrity: JudgeVerdict;
  readonly durability: JudgeVerdict;
  readonly checks: {
    readonly ok: JudgeVerdict;
    readonly refusal?: JudgeVerdict;
    readonly outcome?: JudgeVerdict;
    readonly text?: JudgeVerdict;
    readonly unchangedFrom?: JudgeVerdict;
  };
}
/** Own finite plan before effects. Not an unbounded agent/script interpreter:
 * missing actions/actors/observations fail visibly; no re-seal entropy replay.
 * Each actual start/call/persist/crash/attack crosses an Effect scheduler phase.
 * Raw crypto/DB/HTTP occurs only in the actor, not a duplicate core/reference. */
export const executeLabActions = Effect.fn('Lab.executeActions')(function* (input: {
  readonly actors: Readonly<Record<string, LabActionActor>>;
  readonly actions: readonly unknown[];
  readonly maxSteps: number;
  readonly schedule?: readonly ScheduleChoice[];
  readonly stop?: Effect.Effect<void>;
}) {
  const actions = yield* Effect.try({
    try: () => {
      const rows = input.actions,
        count = rows.length;
      if (!Array.isArray(rows) || !Number.isSafeInteger(count) || count > 256)
        throw new LabActionError({ code: 'invalid-plan' });
      const own = (value: unknown, keys: readonly string[]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new LabActionError({ code: 'invalid-plan' });
        const out: Record<string, unknown> = {};
        for (const key of keys) {
          const property = Object.getOwnPropertyDescriptor(value, key);
          if (property && !('value' in property))
            throw new LabActionError({ code: 'invalid-plan' });
          if (property) out[key] = property.value;
        }
        return out;
      };
      const initial: unknown[] = [];
      for (let index = 0; index < count; index++) {
        const property = Object.getOwnPropertyDescriptor(rows, String(index));
        if (!property || !('value' in property)) throw new LabActionError({ code: 'invalid-plan' });
        initial.push(property.value);
      }
      const owned: LabAction[] = [];
      for (const row of initial) {
        const captured = own(row, [
          'kind',
          'actor',
          'mode',
          'operation',
          'document',
          'text',
          'attack',
          'expect',
        ]);
        if (captured.expect !== undefined) {
          const expected = own(captured.expect, [
            'ok',
            'refusal',
            'outcome',
            'text',
            'unchangedFrom',
          ]);
          if (expected.refusal !== undefined)
            expected.refusal = own(expected.refusal, ['tag', 'code']);
          captured.expect = expected;
        }
        owned.push(Schema.decodeUnknownSync(Action)(captured));
      }

      return owned;
    },
    catch: () => new LabActionError({ code: 'invalid-plan' }),
  });
  const actors = new Map(
    Object.entries(input.actors).map(([name, actor]) => [
      name,
      Object.freeze({
        start: actor.start.bind(actor),
        call: actor.call.bind(actor),
        crash: actor.crash.bind(actor),
      }),
    ])
  );
  if (actions.some((row) => !actors.has(row.actor)))
    return yield* new LabActionError({ code: 'unknown-actor' });
  if (
    actions.some(
      (row, index) =>
        (row.expect?.unchangedFrom !== undefined && row.expect.unchangedFrom >= index) ||
        (row.expect?.ok === false &&
          (row.expect.outcome !== undefined || row.expect.refusal === undefined)) ||
        (row.expect?.ok === true && row.expect.refusal !== undefined) ||
        (row.kind === 'call' &&
          ['create', 'append', 'pull', 'recover', 'observe'].includes(row.operation) &&
          row.document === undefined) ||
        (row.kind === 'call' && row.operation === 'append' && row.text === undefined)
    )
  )
    return yield* new LabActionError({ code: 'invalid-plan' });
  const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
  const observations: LabActionObservation[] = [];
  const work = Effect.gen(function* () {
    for (const action of actions) {
      const actor = actors.get(action.actor)!;
      const operation = action.kind === 'call' ? action.operation : action.kind;
      const reply = yield* runtime.phaseEffect(
        action.actor,
        operation,
        'execute',
        Effect.gen(function* () {
          switch (action.kind) {
            case 'start':
              return yield* actor.start(action.mode);
            case 'call':
              return yield* actor.call(action.operation, action.document, action.text);
            case 'persist':
              return yield* actor.call('persist', action.document);
            case 'attack':
              return yield* actor.call('attack', action.attack);
            case 'crash':
              return { ok: true, value: yield* actor.crash() };
            default:
              return yield* new LabActionError({ code: 'invalid-plan' });
          }
        })
      );
      const { integrity, durability, checks } = yield* Effect.try({
        try: () => assessLabAction(action, reply, observations),
        catch: () => new LabActionError({ code: 'missing-observation' }),
      });
      observations.push({ action, reply, integrity, durability, checks });
    }
    return observations;
  });
  yield* driveLabPermits(runtime, input.schedule ?? 'record', work, {
    maxSteps: input.maxSteps,
    stop: input.stop,
  });
  return {
    observations,
    schedule: runtime.permitLog.map((choice) => ({ ...choice, identity: { ...choice.identity } })),
    verdict: worstVerdict(
      observations.flatMap((row) =>
        row.durability === 'unavailable' ? [row.integrity] : [row.integrity, row.durability]
      )
    ),
    coverage: {
      confidentiality: 'unavailable' as const,
      exactCiphertextReplay: 'unavailable' as const,
    },
  };
});

/** Recompute measurements from observations, never their self-reported verdicts. */
export function assessLabAction(
  action: LabAction,
  reply: LabProcessReply,
  observations: readonly Pick<LabActionObservation, 'reply'>[]
) {
  const matched = action.expect ? reply.ok === action.expect.ok : undefined;
  const checks: {
    ok: JudgeVerdict;
    refusal?: JudgeVerdict;
    outcome?: JudgeVerdict;
    text?: JudgeVerdict;
    unchangedFrom?: JudgeVerdict;
  } = {
    ok: !action.expect
      ? 'unavailable'
      : action.expect.ok
        ? matched
          ? 'pass'
          : 'harness-error'
        : reply.ok
          ? 'violation'
          : 'pass',
  };
  if (!reply.ok) {
    const refusal = action.expect?.refusal;
    checks.refusal =
      !reply.error ||
      reply.error.tag === 'LabHarnessError' ||
      reply.error.tag === 'LabProviderError' ||
      reply.error.tag === 'LabActionFailure' ||
      ['internal_error', 'unknown', 'native', 'invalid-plan'].includes(reply.error.code) ||
      !refusal ||
      refusal.tag !== reply.error.tag ||
      refusal.code !== reply.error.code
        ? 'harness-error'
        : 'pass';
  }
  if (action.expect?.outcome !== undefined) {
    const value = reply.value as { outcome?: string } | undefined;
    checks.outcome =
      reply.ok && value?.outcome === action.expect.outcome ? 'pass' : 'harness-error';
  }
  if (action.expect?.text !== undefined) {
    const value = reply.value as { text?: unknown } | undefined;
    checks.text = judgeClientDurability({
      observed: reply.ok,
      cursorAheadOfDocument: false,
      lostDurableData: value?.text !== action.expect.text,
    });
  }
  if (action.expect?.unchangedFrom !== undefined) {
    const previous = observations[action.expect.unchangedFrom]?.reply.value as
      | { persisted?: unknown }
      | undefined;
    const value = reply.value as { persisted?: unknown } | undefined;
    if (!previous?.persisted || !value?.persisted)
      throw new LabActionError({ code: 'missing-observation' });
    // Independent snapshot of prior actual durable state; do not call production policy as expected value.
    checks.unchangedFrom = judgeClientDurability({
      observed: reply.ok,
      cursorAheadOfDocument: false,
      lostDurableData: JSON.stringify(previous.persisted) !== JSON.stringify(value.persisted),
    });
  }
  // Preserve every applicable measurement: a later pass cannot erase a
  // violation, harness error or unmeasured result from another condition.
  const integrity = worstVerdict([
    checks.ok,
    ...(checks.refusal === undefined ? [] : [checks.refusal]),
    ...(checks.outcome === undefined ? [] : [checks.outcome]),
  ]);
  const durability = worstVerdict([
    ...(checks.text === undefined ? [] : [checks.text]),
    ...(checks.unchangedFrom === undefined ? [] : [checks.unchangedFrom]),
  ]);

  return { integrity, durability, checks };
}

const Evidence = Schema.Struct({
  version: Schema.Literal(1),
  syntheticOnly: Schema.Literal(true),
  run: Schema.Struct({
    observations: Schema.Array(
      Schema.Struct({
        action: Action,
        reply: Schema.Struct({
          ok: Schema.Boolean,
          value: Schema.optional(Schema.Unknown),
          error: Schema.optional(Refusal),
        }),
      })
    ).check(Schema.isMaxLength(256)),
  }),
});
/** Untrusted artifact consistency check, not authentication or a fresh execution.
 * Stored verdict/checks/report fields are deliberately not used. */
export function inspectLabEvidence(input: unknown) {
  const evidence = Schema.decodeUnknownSync(Evidence)(input);
  const observations: LabActionObservation[] = [];
  for (const { action, reply } of evidence.run.observations) {
    if (
      (action.expect?.ok === false && (!action.expect.refusal || action.expect.outcome)) ||
      (action.expect?.ok === true && action.expect.refusal) ||
      (action.kind === 'call' &&
        ['create', 'append', 'pull', 'recover', 'observe'].includes(action.operation) &&
        action.document === undefined) ||
      (action.expect?.unchangedFrom !== undefined &&
        action.expect.unchangedFrom >= observations.length)
    )
      throw new LabActionError({ code: 'invalid-plan' });
    observations.push({ action, reply, ...assessLabAction(action, reply, observations) });
  }
  return {
    version: 1,
    syntheticOnly: true,
    verification: 'recomputed-untrusted-observations',
    run: {
      verdict: worstVerdict(
        observations.flatMap((row) =>
          row.durability === 'unavailable' ? [row.integrity] : [row.integrity, row.durability]
        )
      ),
      observations,
    },
  };
}
