// Draft design model; this does not execute or prove the product implementation.
// Run: node specs/models/workspace-data-service.model.ts (Node 24 strip-types).
// Decision owner: the desktop-data-process architecture proposal, Effect Service section.
// OBS-1: each observation has its own lease; one release cannot end another lease.
// OBS-2: first successful data frame is a snapshot; overflow fails and releases its lease.
// A terminal reset error may precede the snapshot and does not wait for the consumer to read it.
// GEN-1: late reads/token/observation results cannot cross auth or owner generations.
// CMD-1: caller cancellation ends waiting; only the command owner decides execution outcome.
// Assumptions: serialized abstract transitions, finite scalar snapshots, immutable frames,
// one producer lifecycle, one subscription per observer, and command admission that atomically
// checks authority and applies the business change. Persistence is an abstract completion event.
// Command receipt recovery describes the future owner contract; it does not assert that all
// phase-one adapters provide durable receipts. Restart forgets non-durable owner outcomes.
// DIR-1: a live directory query reprojects its first page after each known directory event.
// DIR-2: an old page cursor needs reset when that query's ordered membership changes;
// metadata-only changes may retain it. This query boundary is not a write/durability revision.
// DIR-3: bootstrap fills missing fields only; live fields/explicit clears win and tombstones
// prevent a late bootstrap result from reviving a deleted session.
// BACKEND-1: existing sessions bind to hydrated metadata ('loro' or 'roost'), not a feature flag.
// EDIT-1: omission/keep preserve current credentials; explicit edits check targeted conditions.
// HANDLE-1: a session observation ends with either its handle or its execution Scope.
// VIEW-1: reset retires the old source; only a fresh initial can establish live coverage again.
// VIEW-2: denied/closed sources cannot retry; release fences pending recovery and read results.
// The directory/backend checks below exhaust finite decision matrices, not transition traces
// or product tests. They use 3 initial rows, at most 4 rows, one live event per query, page
// limits 1/2, two bootstrap orderings, and an explicit finite backend selection table.
// Excludes Loro/Effect/IPC/SQLite implementation, crash recovery mechanics, fairness, latency,
// memory byte limits, actual pagination/cursor encoding, directory indexing cost, archive
// cascades, backend migration, legacy raw JSON conversion, deduplication, network retries
// and real durability. Raw JSON is an interchange/legacy shape, not a third live backend.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type CheckStats = { reachableStates: number; checkedTransitions: number; traceDepthLimit: number };

// Check every enabled transition from every distinct reachable state up to this depth.
// A state reached by a shorter trace has at least as much remaining exploration budget.
function explore<State, Event>(
  initial: State,
  events: (state: State) => Event[],
  step: (state: State, event: Event) => State,
  check: (before: State, event: Event, after: State) => void,
  traceDepthLimit: number
): { states: State[]; stats: CheckStats } {
  const states = [initial];
  const pending = [{ state: initial, depth: 0, trace: [] as Event[] }];
  const seen = new Set([JSON.stringify(initial)]);
  let checkedTransitions = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor]!;
    if (current.depth === traceDepthLimit) continue;
    for (const event of events(current.state)) {
      const after = step(current.state, event);
      try {
        check(current.state, event, after);
      } catch (error) {
        throw new Error(JSON.stringify({ trace: [...current.trace, event], error: String(error) }));
      }
      checkedTransitions++;
      const key = JSON.stringify(after);
      if (!seen.has(key)) {
        seen.add(key);
        states.push(after);
        pending.push({ state: after, depth: current.depth + 1, trace: [...current.trace, event] });
      }
    }
  }
  return { states, stats: { reachableStates: seen.size, checkedTransitions, traceDepthLimit } };
}

type ObserverId = 0 | 1;
const observerIds: readonly ObserverId[] = [0, 1];
type Frame = { kind: 'snapshot' | 'change' | 'reset'; revision: number };
type Observer = {
  phase: 'unused' | 'capturing' | 'ready' | 'ended';
  capturedRevision: number;
  updates: number[];
  resetRevision: number | null;
  delivered: Frame[];
};
type ObservationState = {
  revision: number;
  producer: 'unused' | 'running' | 'closing' | 'closed';
  observers: [Observer, Observer];
};
type ObservationEvent =
  | { kind: 'subscribe' | 'snapshot-ready' | 'receive' | 'close'; id: ObserverId }
  | { kind: 'publish' }
  | { kind: 'cleanup-complete' };
const hasLease = (observer: Observer) => ['capturing', 'ready'].includes(observer.phase);
const activeLeases = (state: ObservationState) => state.observers.filter(hasLease).length;
const makeObserver = (): Observer => ({
  phase: 'unused',
  capturedRevision: 0,
  updates: [],
  resetRevision: null,
  delivered: [],
});

function observationEvents(state: ObservationState): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  for (const id of observerIds) {
    const observer = state.observers[id];
    if (observer.phase === 'unused' && ['unused', 'running'].includes(state.producer)) {
      events.push({ kind: 'subscribe', id });
    }
    if (observer.phase === 'capturing' || observer.phase === 'ended') {
      events.push({ kind: 'snapshot-ready', id });
    }
    if (
      (observer.phase === 'ready' && observer.updates.length) ||
      observer.resetRevision !== null
    ) {
      events.push({ kind: 'receive', id });
    }
    if (hasLease(observer)) events.push({ kind: 'close', id });
  }
  if (state.producer === 'running' && state.revision < 4) events.push({ kind: 'publish' });
  if (state.producer === 'closing') events.push({ kind: 'cleanup-complete' });
  return events;
}

function observationStep(
  state: ObservationState,
  event: ObservationEvent,
  capacity: 1 | 2
): ObservationState {
  const next: ObservationState = {
    ...state,
    observers: state.observers.map((observer) => ({
      ...observer,
      updates: [...observer.updates],
      delivered: [...observer.delivered],
    })) as [Observer, Observer],
  };
  if (event.kind === 'publish') {
    next.revision++;
    for (const observer of next.observers.filter(hasLease)) {
      if (observer.updates.length === capacity) {
        // Reset is a control outcome, outside the full update buffer; no global producer wait.
        observer.updates = [];
        observer.resetRevision = next.revision;
        observer.phase = 'ended';
      } else {
        observer.updates.push(next.revision);
      }
    }
  } else if (event.kind === 'cleanup-complete') {
    next.producer = 'closed';
  } else {
    const observer = next.observers[event.id];
    if (event.kind === 'subscribe') {
      observer.phase = 'capturing';
      observer.capturedRevision = next.revision;
      next.producer = 'running';
    } else if (event.kind === 'snapshot-ready') {
      if (observer.phase === 'capturing') {
        observer.phase = 'ready';
        observer.delivered.push({ kind: 'snapshot', revision: observer.capturedRevision });
      }
    } else if (event.kind === 'receive') {
      if (observer.resetRevision !== null) {
        observer.delivered.push({ kind: 'reset', revision: observer.resetRevision });
        observer.resetRevision = null;
        observer.phase = 'ended';
      } else {
        observer.delivered.push({ kind: 'change', revision: observer.updates.shift()! });
      }
    } else {
      observer.phase = 'ended';
      observer.updates = [];
      observer.resetRevision = null;
    }
  }
  if (activeLeases(next) === 0 && next.producer === 'running') next.producer = 'closing';
  return next;
}

const observationChecks: {
  capacity: number;
  stats: CheckStats;
  witnesses: Record<string, number>;
}[] = [];
for (const capacity of [1, 2] as const) {
  const witnesses = {
    independentRelease: 0,
    bufferedBeforeSnapshot: 0,
    explicitOverflow: 0,
    progressDespiteReset: 0,
    ignoredLateSnapshots: 0,
  };
  const result = explore(
    {
      revision: 0,
      producer: 'unused',
      observers: [makeObserver(), makeObserver()],
    } as ObservationState,
    observationEvents,
    (state, event) => observationStep(state, event, capacity),
    (before, event, after) => {
      assert(
        activeLeases(after) === 0 || after.producer === 'running',
        'OBS-1: active lease needs producer'
      );
      assert(
        after.producer !== 'closed' || activeLeases(after) === 0,
        'OBS-1: actual cleanup follows final lease release'
      );
      if (event.kind === 'close' && activeLeases(before) === 2) {
        const other: ObserverId = event.id === 0 ? 1 : 0;
        assert(after.producer === 'running', 'OBS-1: one lease cannot close shared producer');
        assert(
          JSON.stringify(after.observers[other]) === JSON.stringify(before.observers[other]),
          'OBS-1: other observer unchanged'
        );
        witnesses.independentRelease++;
      }
      if (event.kind === 'snapshot-ready' && before.observers[event.id].phase === 'ended') {
        assert(
          JSON.stringify(after.observers[event.id]) === JSON.stringify(before.observers[event.id]),
          'OBS-2: late snapshot cannot revive an ended observation'
        );
        witnesses.ignoredLateSnapshots++;
      }
      for (const id of observerIds) {
        const observer = after.observers[id];
        assert(observer.updates.length <= capacity, 'OBS-2: bounded update buffer');
        if (observer.resetRevision !== null) {
          assert(!hasLease(observer), 'OBS-2: overflow releases lease before error consumption');
          assert(observer.updates.length === 0, 'OBS-2: overflow releases buffered data');
          witnesses.explicitOverflow++;
        }
        if (event.kind === 'publish' && hasLease(before.observers[id])) {
          if (before.observers[id].updates.length === capacity) {
            assert(
              observer.phase === 'ended' && observer.resetRevision !== null,
              'OBS-2: full buffer must fail this observer immediately'
            );
          } else {
            assert(
              hasLease(observer),
              'OBS-1: another observer overflow cannot release this lease'
            );
          }
        }
        if (observer.phase === 'capturing') {
          assert(observer.delivered.length === 0, 'OBS-2: no update delivery before snapshot');
          if (observer.updates.length) witnesses.bufferedBeforeSnapshot++;
        }
        if (observer.delivered.length) {
          const dataFrames = observer.delivered.filter((frame) => frame.kind !== 'reset');
          if (dataFrames.length) {
            assert(
              dataFrames[0]!.kind === 'snapshot',
              'OBS-2: first successful data frame is snapshot'
            );
            assert(
              dataFrames[0]!.revision === observer.capturedRevision,
              'OBS-2: snapshot boundary retained'
            );
          }
          if (observer.delivered.some((frame) => frame.kind === 'reset')) {
            assert(observer.phase === 'ended', 'OBS-2: error cannot hold active lease');
          }
          for (let index = 1; index < observer.delivered.length; index++) {
            const previous = observer.delivered[index - 1]!;
            const frame = observer.delivered[index]!;
            assert(previous.kind !== 'reset', 'OBS-2: reset terminates this observation');
            if (frame.kind === 'change') {
              assert(frame.revision === previous.revision + 1, 'OBS-2: no silent event gap');
            }
            if (frame.kind === 'reset') {
              assert(observer.phase === 'ended', 'OBS-2: reset releases only this lease');
            }
          }
        }
        if (hasLease(observer)) {
          const lastRevision = observer.delivered.at(-1)?.revision ?? observer.capturedRevision;
          const expected = Array.from(
            { length: after.revision - lastRevision },
            (_, index) => lastRevision + index + 1
          );
          assert(
            JSON.stringify(observer.updates) === JSON.stringify(expected),
            'OBS-2: every live undelivered update is buffered'
          );
        }
      }
      if (event.kind === 'publish') {
        assert(after.revision === before.revision + 1, 'OBS-2: no observer can block publish');
        if (before.observers.some((observer) => observer.resetRevision !== null)) {
          witnesses.progressDespiteReset++;
        }
      }
    },
    6
  );
  assert(
    Object.values(witnesses).every((count) => count > 0),
    'Observation bounds must cover all named risks'
  );
  observationChecks.push({ capacity, stats: result.stats, witnesses });
}

type Generation = { auth: 0 | 1; owner: 0 | 1 };
type GenerationRequest = {
  phase: 'pending' | 'accepted' | 'stale';
  started: Generation;
  completed: Generation | null;
};
type GenerationState = Generation & {
  requests: [GenerationRequest | null, GenerationRequest | null];
  visible: Generation[];
};
type GenerationEvent =
  | { kind: 'start' | 'complete'; id: ObserverId }
  | { kind: 'change-auth' }
  | { kind: 'change-owner' };
const sameGeneration = (left: Generation, right: Generation) =>
  left.auth === right.auth && left.owner === right.owner;
let staleAuthResults = 0;
let staleOwnerResults = 0;
const generationCheck = explore(
  { auth: 0, owner: 0, requests: [null, null], visible: [] } as GenerationState,
  (state): GenerationEvent[] => {
    const events: GenerationEvent[] = [];
    for (const id of observerIds) {
      if (state.requests[id] === null) events.push({ kind: 'start', id });
      if (state.requests[id]?.phase === 'pending') events.push({ kind: 'complete', id });
    }
    if (state.auth === 0) events.push({ kind: 'change-auth' });
    if (state.owner === 0) events.push({ kind: 'change-owner' });
    return events;
  },
  (state, event) => {
    const next: GenerationState = {
      ...state,
      requests: [...state.requests],
      visible: [...state.visible],
    };
    if (event.kind === 'change-auth' || event.kind === 'change-owner') {
      if (event.kind === 'change-auth') next.auth = 1;
      else next.owner = 1;
      next.visible = [];
    } else if (event.kind === 'start') {
      next.requests[event.id] = {
        phase: 'pending',
        started: { auth: state.auth, owner: state.owner },
        completed: null,
      };
    } else {
      const request = state.requests[event.id]!;
      const accepted = sameGeneration(request.started, state);
      next.requests[event.id] = {
        ...request,
        phase: accepted ? 'accepted' : 'stale',
        completed: { auth: state.auth, owner: state.owner },
      };
      if (accepted) next.visible.push(request.started);
    }
    return next;
  },
  (_before, _event, after) => {
    assert(
      after.visible.every((generation) => sameGeneration(generation, after)),
      'GEN-1: only current generation visible'
    );
    for (const request of after.requests) {
      if (request === null || request.phase === 'pending') continue;
      assert(
        (request.phase === 'accepted') === sameGeneration(request.started, request.completed!),
        'GEN-1: late result accepted iff epochs match'
      );
      if (request.phase === 'stale' && request.started.auth !== request.completed!.auth) {
        staleAuthResults++;
      }
      if (request.phase === 'stale' && request.started.owner !== request.completed!.owner) {
        staleOwnerResults++;
      }
    }
  },
  6
);
assert(
  staleAuthResults > 0 && staleOwnerResults > 0,
  'Generation bounds must cover both stale-result risks'
);

type CommandPhase = 'unsent' | 'sent' | 'admitted' | 'committed' | 'rejected' | 'uncertain';
type CommandState = {
  phase: CommandPhase;
  waiting: boolean;
  canceledAt: CommandPhase | null;
  authority: 0 | 1;
  owner: 0 | 1;
  ownerLease: boolean;
  applied: boolean;
};
type CommandEvent =
  | 'dispatch'
  | 'cancel'
  | 'change-authority'
  | 'admit'
  | 'commit'
  | 'restart-owner';
// No response = uncertain, not proof of rejection. Admitted = owned, not proof of durability.
function ownerOutcome(
  state: CommandState
): 'not-submitted' | 'unknown' | 'owned' | 'committed' | 'rejected' {
  if (state.phase === 'unsent') return 'not-submitted';
  if (state.phase === 'sent' || state.phase === 'uncertain') return 'unknown';
  if (state.phase === 'admitted') return 'owned';
  return state.phase;
}
const commandCheck = explore(
  {
    phase: 'unsent',
    waiting: true,
    canceledAt: null,
    authority: 0,
    owner: 0,
    ownerLease: false,
    applied: false,
  } as CommandState,
  (state): CommandEvent[] => {
    const events: CommandEvent[] = [];
    if (state.phase === 'unsent' && state.waiting) events.push('dispatch');
    if (state.waiting) events.push('cancel');
    if (state.authority === 0) events.push('change-authority');
    if (state.owner === 0) events.push('restart-owner');
    if (state.phase === 'sent') events.push('admit');
    if (state.phase === 'admitted') events.push('commit');
    return events;
  },
  (state, event) => {
    const next = { ...state };
    if (event === 'dispatch') next.phase = 'sent';
    if (event === 'cancel') {
      next.waiting = false;
      next.canceledAt = state.phase;
    }
    if (event === 'change-authority') next.authority = 1;
    if (event === 'admit') {
      next.phase = state.authority === 0 ? 'admitted' : 'rejected';
      next.ownerLease = next.phase === 'admitted';
      next.applied = next.phase === 'admitted';
    }
    if (event === 'commit') {
      next.phase = 'committed';
      next.ownerLease = false;
    }
    if (event === 'restart-owner') {
      next.owner = 1;
      next.ownerLease = false;
      if (['sent', 'admitted', 'rejected'].includes(state.phase)) next.phase = 'uncertain';
    }
    return next;
  },
  (before, event, after) => {
    assert(
      after.ownerLease === (after.phase === 'admitted'),
      'CMD-1: write owner retains lease until actual completion'
    );
    if (event === 'cancel') {
      assert(
        ownerOutcome(before) === ownerOutcome(after),
        'CMD-1: caller cancellation cannot change owner outcome'
      );
      assert(before.ownerLease === after.ownerLease, 'CMD-1: caller cannot release command owner');
    }
    if (after.phase === 'rejected') {
      assert(after.authority === 1, 'CMD-1: only owner authority check rejects command');
      assert(!after.applied, 'CMD-1: rejection is valid only before business apply');
    }
    if (after.phase === 'committed') {
      assert(after.applied, 'CMD-1: durable outcome requires applied command');
    }
    if (event === 'restart-owner' && before.phase === 'admitted') {
      assert(ownerOutcome(after) === 'unknown', 'CMD-1: restart loses non-durable applied outcome');
    }
    if (after.phase === 'committed' && before.phase !== 'committed') {
      assert(before.phase === 'admitted', 'CMD-1: commit requires owner admission');
    }
    if (before.phase === 'committed') {
      assert(after.phase === 'committed', 'CMD-1: committed outcome survives caller/auth changes');
    }
  },
  6
);
const commandWitnesses = {
  canceledBeforeAdmissionThenCommitted: commandCheck.states.filter(
    (state) => state.canceledAt === 'sent' && state.phase === 'committed'
  ).length,
  canceledAfterAdmissionOwnerContinued: commandCheck.states.filter(
    (state) => state.canceledAt === 'admitted' && state.phase === 'committed'
  ).length,
  canceledAfterDispatchStillUnknown: commandCheck.states.filter(
    (state) => state.canceledAt === 'sent' && ownerOutcome(state) === 'unknown'
  ).length,
  restartedAfterApplyOutcomeUnknown: commandCheck.states.filter(
    (state) => state.owner === 1 && state.applied && ownerOutcome(state) === 'unknown'
  ).length,
  restartedAfterDurableOutcomeRecovered: commandCheck.states.filter(
    (state) => state.owner === 1 && state.phase === 'committed'
  ).length,
};
assert(
  Object.values(commandWitnesses).every((count) => count > 0),
  'Command bounds must cover cancellation before and after admission'
);

// Separate decision matrices: do not add these cases to the bounded exploration statistics.
type DirectoryRow = {
  id: string;
  title: string;
  archived: boolean;
  project: 'red' | 'blue';
  parent: string | null;
  location?: string | null;
};
type DirectoryPatch = Partial<Omit<DirectoryRow, 'id'>>;
type DirectoryEvent =
  | { kind: 'create'; row: DirectoryRow }
  | { kind: 'patch'; id: string; fields: DirectoryPatch }
  | { kind: 'delete'; id: string };
type DirectoryQuery = {
  archived: 'all' | boolean;
  project: 'all' | 'red' | 'blue';
  parent: 'all' | 'a' | 'b' | null;
  order: 'ascending' | 'descending';
  limit: 1 | 2;
};
type DirectoryIndex = {
  rows: Map<string, DirectoryRow>;
  deleted: Set<string>;
  deliverySequence: number;
};
const baseRows: readonly DirectoryRow[] = [
  { id: 'a', title: 'Bravo', archived: false, project: 'red', parent: null },
  { id: 'b', title: 'Charlie', archived: true, project: 'blue', parent: 'a' },
  { id: 'c', title: 'Delta', archived: false, project: 'blue', parent: 'a' },
];
const newRow: DirectoryRow = {
  id: 'd',
  title: 'Alpha',
  archived: false,
  project: 'red',
  parent: null,
};
const makeDirectoryIndex = (): DirectoryIndex => ({
  rows: new Map(baseRows.map((row) => [row.id, { ...row }])),
  deleted: new Set(),
  deliverySequence: 0,
});
function applyDirectoryEvent(index: DirectoryIndex, event: DirectoryEvent): void {
  if (event.kind === 'delete') {
    index.rows.delete(event.id);
    index.deleted.add(event.id);
  } else if (event.kind === 'create') {
    index.rows.set(event.row.id, { ...event.row });
    index.deleted.delete(event.row.id); // Only explicit creation may revive an identity.
  } else {
    const row = index.rows.get(event.id);
    assert(row !== undefined, 'DIR-1: fixture patches an existing session');
    index.rows.set(event.id, { ...row, ...event.fields });
  }
  index.deliverySequence++;
}
function orderedDirectoryRows(rows: Iterable<DirectoryRow>, query: DirectoryQuery): DirectoryRow[] {
  return [...rows]
    .filter(
      (row) =>
        (query.archived === 'all' || row.archived === query.archived) &&
        (query.project === 'all' || row.project === query.project) &&
        (query.parent === 'all' || row.parent === query.parent)
    )
    .sort((left, right) => {
      const a = `${left.title}:${left.id}`;
      const b = `${right.title}:${right.id}`;
      const ascending = a < b ? -1 : a > b ? 1 : 0;
      return query.order === 'ascending' ? ascending : -ascending;
    });
}
function observeDirectoryPage(index: DirectoryIndex, query: DirectoryQuery) {
  const orderedRows = orderedDirectoryRows(index.rows.values(), query);
  return {
    rows: orderedRows.slice(0, query.limit),
    deliverySequence: index.deliverySequence,
    // Abstract query boundary: not an actual implementation of stable pagination.
    cursorBoundary: orderedRows.map((row) => row.id).join(','),
  };
}
const patchDirectoryFixtures: readonly [name: string, id: string, fields: DirectoryPatch][] = [
  ['rename-sort-move', 'a', { title: 'Zulu' }],
  ['rename-other-sort-move', 'c', { title: 'Aardvark' }],
  ['archive', 'a', { archived: true }],
  ['restore', 'b', { archived: false }],
  ['project-membership', 'a', { project: 'blue' }],
  ['project-other-membership', 'c', { project: 'red' }],
  ['parent-membership', 'c', { parent: 'b' }],
  ['detach-parent', 'c', { parent: null }],
  ['metadata-only', 'a', { location: '/synthetic/new' }],
];
const directoryFixtures: {
  name: string;
  event: DirectoryEvent;
  expected: readonly DirectoryRow[];
}[] = [
  { name: 'create', event: { kind: 'create', row: newRow }, expected: [...baseRows, newRow] },
  ...patchDirectoryFixtures.map(([name, id, fields]) => ({
    name,
    event: { kind: 'patch' as const, id, fields },
    expected: baseRows.map((row) => (row.id === id ? { ...row, ...fields } : row)),
  })),
  ...['a', 'b', 'c'].map((id) => ({
    name: 'delete',
    event: { kind: 'delete' as const, id },
    expected: baseRows.filter((row) => row.id !== id),
  })),
];
const directoryWitnesses = {
  changedFirstPage: 0,
  boundaryReset: 0,
  cursorRetainedWithNewDelivery: 0,
  filteredMembershipChange: 0,
  parentMembershipChange: 0,
};
let directoryMatrixCases = 0;
for (const archived of ['all', false, true] as const) {
  for (const project of ['all', 'red', 'blue'] as const) {
    for (const parent of ['all', null, 'a', 'b'] as const) {
      for (const order of ['ascending', 'descending'] as const) {
        for (const limit of [1, 2] as const) {
          const query = { archived, project, parent, order, limit };
          for (const fixture of directoryFixtures) {
            const index = makeDirectoryIndex();
            const before = observeDirectoryPage(index, query);
            applyDirectoryEvent(index, fixture.event);
            const after = observeDirectoryPage(index, query);
            const expectedRows = orderedDirectoryRows(fixture.expected, query);
            assert(
              JSON.stringify(after.rows) === JSON.stringify(expectedRows.slice(0, limit)),
              `DIR-1: live first page must match current query: ${fixture.name}`
            );
            assert(after.rows.length <= limit, 'DIR-1: page size remains bounded');
            assert(
              after.deliverySequence > before.deliverySequence,
              'DIR-1: event advances delivery'
            );
            const expectedBoundary = expectedRows.map((row) => row.id).join(',');
            const cursorNeedsReset = before.cursorBoundary !== after.cursorBoundary;
            assert(
              cursorNeedsReset === (before.cursorBoundary !== expectedBoundary),
              'DIR-2: reset follows ordered query membership, not metadata delivery sequence'
            );
            if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
              directoryWitnesses.changedFirstPage++;
            }
            if (cursorNeedsReset) directoryWitnesses.boundaryReset++;
            else directoryWitnesses.cursorRetainedWithNewDelivery++;
            if (cursorNeedsReset && (archived !== 'all' || project !== 'all')) {
              directoryWitnesses.filteredMembershipChange++;
            }
            if (cursorNeedsReset && parent !== 'all' && fixture.name.includes('parent')) {
              directoryWitnesses.parentMembershipChange++;
            }
            directoryMatrixCases++;
          }
        }
      }
    }
  }
}
assert(
  Object.values(directoryWitnesses).every((count) => count > 0),
  'Directory witnesses covered'
);

function mergeBootstrapMissing(index: DirectoryIndex, seed: DirectoryRow): void {
  if (index.deleted.has(seed.id)) return;
  const current = index.rows.get(seed.id);
  if (!current) {
    index.rows.set(seed.id, { ...seed });
    return;
  }
  const missing = Object.fromEntries(
    Object.entries(seed).filter(([field]) => !Object.hasOwn(current, field))
  );
  index.rows.set(seed.id, { ...current, ...missing });
}
const bootstrapWitnesses = {
  liveFieldsWin: 0,
  missingFieldsFilled: 0,
  explicitClearWins: 0,
  deletedNotRevived: 0,
};
let bootstrapMatrixCases = 0;
for (const bootstrapFirst of [false, true]) {
  for (const event of [
    { kind: 'patch', id: 'a', fields: { title: 'Live', project: 'blue' } },
    { kind: 'patch', id: 'a', fields: { location: null } },
    { kind: 'delete', id: 'a' },
  ] as const) {
    const index = makeDirectoryIndex();
    const seed: DirectoryRow = { ...baseRows[0]!, title: 'Stale', location: '/synthetic/seed' };
    if (bootstrapFirst) mergeBootstrapMissing(index, seed);
    applyDirectoryEvent(index, event);
    if (!bootstrapFirst) mergeBootstrapMissing(index, seed);
    const row = index.rows.get('a');
    if (event.kind === 'delete') {
      assert(row === undefined, 'DIR-3: a late seed cannot revive deletion');
      bootstrapWitnesses.deletedNotRevived++;
    } else if ('title' in event.fields) {
      assert(
        row?.title === 'Live' && row.project === 'blue',
        'DIR-3: stale seed cannot overwrite live fields'
      );
      assert(row.location === '/synthetic/seed', 'DIR-3: bootstrap still fills missing fields');
      bootstrapWitnesses.liveFieldsWin++;
      bootstrapWitnesses.missingFieldsFilled++;
    } else {
      assert(row?.location === null, 'DIR-3: explicit live clear is not a missing field');
      bootstrapWitnesses.explicitClearWins++;
    }
    bootstrapMatrixCases++;
  }
}
assert(
  Object.values(bootstrapWitnesses).every((count) => count > 0),
  'Bootstrap witnesses covered'
);

type BackendKind = 'loro' | 'roost';
type BackendSelection =
  | { status: 'bound'; kind: BackendKind }
  | { status: 'error'; error: 'MetadataPending' | 'UnsupportedBackend' | 'BackendUnavailable' };
function bindExistingBackend(input: {
  hydrated: boolean;
  marker: undefined | BackendKind | 'unknown';
  roostAdapterAvailable: boolean;
  newSessionRoostFlag: boolean;
}): BackendSelection {
  if (!input.hydrated) return { status: 'error', error: 'MetadataPending' };
  if (input.marker === 'unknown') return { status: 'error', error: 'UnsupportedBackend' };
  const kind = input.marker ?? 'loro';
  if (kind === 'roost' && !input.roostAdapterAvailable) {
    return { status: 'error', error: 'BackendUnavailable' };
  }
  // The creation flag intentionally does not select the backend of an existing session.
  return { status: 'bound', kind };
}
const backendWitnesses = {
  unhydratedNotGuessed: 0,
  hydratedLegacyLoro: 0,
  unknownRejected: 0,
  unavailableRoostRejected: 0,
  roostBound: 0,
  flagToggleKeepsBinding: 0,
};
let backendMatrixCases = 0;
for (const hydrated of [false, true]) {
  for (const marker of [undefined, 'loro', 'roost', 'unknown'] as const) {
    for (const roostAdapterAvailable of [false, true]) {
      for (const newSessionRoostFlag of [false, true]) {
        const input = { hydrated, marker, roostAdapterAvailable, newSessionRoostFlag };
        const selected = bindExistingBackend(input);
        if (!hydrated) {
          assert(
            selected.status === 'error' && selected.error === 'MetadataPending',
            'BACKEND-1: hydration is required even with a marker'
          );
          backendWitnesses.unhydratedNotGuessed++;
        } else if (marker === 'unknown') {
          assert(
            selected.status === 'error' && selected.error === 'UnsupportedBackend',
            'BACKEND-1: unknown is not Loro fallback'
          );
          backendWitnesses.unknownRejected++;
        } else if (marker === 'roost' && !roostAdapterAvailable) {
          assert(
            selected.status === 'error' && selected.error === 'BackendUnavailable',
            'BACKEND-1: unavailable Roost cannot silently bind Loro'
          );
          backendWitnesses.unavailableRoostRejected++;
        } else {
          assert(
            selected.status === 'bound' && selected.kind === (marker ?? 'loro'),
            'BACKEND-1: binding follows hydrated persisted identity'
          );
          if (marker === undefined) backendWitnesses.hydratedLegacyLoro++;
          if (selected.kind === 'roost') backendWitnesses.roostBound++;
          const afterFlagChange = bindExistingBackend({
            ...input,
            newSessionRoostFlag: !newSessionRoostFlag,
          });
          assert(
            JSON.stringify(afterFlagChange) === JSON.stringify(selected),
            'BACKEND-1: flag toggle preserves already bound history kind'
          );
          backendWitnesses.flagToggleKeepsBinding++;
        }
        backendMatrixCases++;
      }
    }
  }
}
assert(
  Object.values(backendWitnesses).every((count) => count > 0),
  'Backend witnesses covered'
);

// A finite editor model, not the real form, field validator or Flock transaction.
// Synthetic secrets never leave the owner projection; env/header updates are per key.
type SecretSlot = 'env' | 'header' | 'token';
type SecretAction = 'omit' | 'keep' | 'replace' | 'empty' | 'clear';
const secretSlots: readonly SecretSlot[] = ['env', 'header', 'token'];
const secretActions: readonly SecretAction[] = ['omit', 'keep', 'replace', 'empty', 'clear'];
type EditorConfig = {
  id: string;
  transport: 'stdio' | 'http';
  name: string;
  secrets: Record<SecretSlot, string | undefined>;
  otherEnv: string;
  otherHeader: string;
  unknownField: string;
};
type EditorPatch = { rename: boolean; actions: Record<SecretSlot, SecretAction> };
function readEditorProjection(config: EditorConfig, canManage: boolean) {
  return canManage
    ? {
        id: config.id,
        transport: config.transport,
        name: config.name,
        present: Object.fromEntries(
          secretSlots.map((key) => [key, config.secrets[key] !== undefined])
        ),
      }
    : undefined;
}
function applyEditorPatch(
  original: EditorConfig,
  current: EditorConfig,
  patch: EditorPatch,
  canManage: boolean
): { status: 'applied'; config: EditorConfig } | { status: 'denied' | 'condition-changed' } {
  if (!canManage) return { status: 'denied' };
  if (
    original.id !== current.id ||
    original.transport !== current.transport ||
    (patch.rename && original.name !== current.name) ||
    secretSlots.some(
      (key) =>
        !['omit', 'keep'].includes(patch.actions[key]) &&
        original.secrets[key] !== current.secrets[key]
    )
  )
    return { status: 'condition-changed' };
  const next = { ...current, secrets: { ...current.secrets } };
  if (patch.rename) next.name = 'Renamed';
  for (const key of secretSlots) {
    const action = patch.actions[key];
    if (action === 'replace') next.secrets[key] = `synthetic-new-${key}`;
    else if (action === 'empty') next.secrets[key] = '';
    else if (action === 'clear') next.secrets[key] = undefined;
  }
  return { status: 'applied', config: next };
}
const editorWitnesses = {
  denied: 0,
  maskedProjection: 0,
  renameKeepsSecrets: 0,
  explicitReplace: 0,
  explicitClear: 0,
  emptyIsNotDeletion: 0,
  concurrentUneditedSecretRetained: 0,
  staleEditedFieldRejected: 0,
  unrelatedAndUnknownPreserved: 0,
};
let editorMatrixCases = 0;
for (const transport of ['stdio', 'http'] as const) {
  const original: EditorConfig = {
    id: 'synthetic-catalog-id',
    transport,
    name: 'Original',
    secrets: {
      env: transport === 'stdio' ? 'synthetic-env-secret' : undefined,
      header: transport === 'http' ? 'synthetic-header-secret' : undefined,
      token: transport === 'http' ? 'synthetic-token-secret' : undefined,
    },
    otherEnv: 'synthetic-unedited-env',
    otherHeader: 'synthetic-unedited-header',
    unknownField: 'opaque-preserved',
  };
  for (const canManage of [false, true]) {
    const projection = readEditorProjection(original, canManage);
    if (!canManage)
      assert(projection === undefined, 'EDIT-1: unauthorized editor has no projection');
    else {
      assert(projection !== undefined, 'EDIT-1: authorized editor projection exists');
      assert(
        Object.values(projection.present).every((value) => typeof value === 'boolean'),
        'EDIT-1: credential projection contains presence, not secret values'
      );
      editorWitnesses.maskedProjection++;
    }
    for (const rename of [false, true]) {
      for (const env of transport === 'stdio' ? secretActions : (['omit'] as const)) {
        for (const header of transport === 'http' ? secretActions : (['omit'] as const)) {
          for (const token of transport === 'http' ? secretActions : (['omit'] as const)) {
            for (const concurrent of [
              'none',
              'name',
              'credential',
              'unrelated',
              'target',
            ] as const) {
              const current = { ...original, secrets: { ...original.secrets } };
              const changedSlot: SecretSlot = transport === 'stdio' ? 'env' : 'token';
              if (concurrent === 'name') current.name = 'Concurrent name';
              if (concurrent === 'credential')
                current.secrets[changedSlot] = 'synthetic-concurrent-secret';
              if (concurrent === 'unrelated') current.unknownField = 'opaque-concurrent';
              if (concurrent === 'target') current.id = 'different-target';
              const before = JSON.stringify(current);
              const patch = { rename, actions: { env, header, token } };
              const result = applyEditorPatch(original, current, patch, canManage);
              const editsChangedSecret = !['omit', 'keep'].includes(patch.actions[changedSlot]);
              const conditionChanged =
                concurrent === 'target' ||
                (concurrent === 'name' && rename) ||
                (concurrent === 'credential' && editsChangedSecret);
              if (!canManage) {
                assert(
                  result.status === 'denied',
                  'EDIT-1: authorization rechecked before any patch'
                );
                editorWitnesses.denied++;
              } else if (conditionChanged) {
                assert(
                  result.status === 'condition-changed',
                  'EDIT-1: changed edit condition rejects the patch'
                );
                editorWitnesses.staleEditedFieldRejected++;
              } else {
                assert(
                  result.status === 'applied',
                  'EDIT-1: unrelated changes do not reject an edit'
                );
                const next = result.config;
                assert(
                  next.name === (rename ? 'Renamed' : current.name),
                  'EDIT-1: only explicit name edit applies'
                );
                assert(
                  next.otherEnv === current.otherEnv &&
                    next.otherHeader === current.otherHeader &&
                    next.unknownField === current.unknownField,
                  'EDIT-1: unedited keys and unknown fields survive'
                );
                editorWitnesses.unrelatedAndUnknownPreserved++;
                for (const key of secretSlots) {
                  const action = patch.actions[key];
                  if (action === 'omit' || action === 'keep') {
                    assert(
                      next.secrets[key] === current.secrets[key],
                      'EDIT-1: omitted/kept secret is current owner value'
                    );
                  } else if (action === 'clear') {
                    assert(
                      next.secrets[key] === undefined,
                      'EDIT-1: clear removes the selected value'
                    );
                    editorWitnesses.explicitClear++;
                  } else {
                    assert(
                      next.secrets[key] === (action === 'empty' ? '' : `synthetic-new-${key}`),
                      'EDIT-1: replace applies the explicit value'
                    );
                    if (action === 'empty') editorWitnesses.emptyIsNotDeletion++;
                    else editorWitnesses.explicitReplace++;
                  }
                }
                if (
                  rename &&
                  secretSlots.every((key) => ['omit', 'keep'].includes(patch.actions[key]))
                ) {
                  editorWitnesses.renameKeepsSecrets++;
                }
                if (concurrent === 'credential' && !editsChangedSecret) {
                  editorWitnesses.concurrentUneditedSecretRetained++;
                }
              }
              assert(
                JSON.stringify(current) === before,
                'EDIT-1: evaluation does not mutate owner input on refusal'
              );
              editorMatrixCases++;
            }
          }
        }
      }
    }
  }
}
assert(
  Object.values(editorWitnesses).every((count) => count > 0),
  'Editor witnesses covered'
);

// Two already-open session handles, each with two independent observer execution Scopes.
// Actual finalizer completion and command-held raw I/O remain outside this reader model.
type HandleObserver = 'unused' | 'live' | 'ended';
type ReadPhase = 'unused' | 'pending' | 'published' | 'closed';
type ReaderHandle = { open: boolean; observers: [HandleObserver, HandleObserver]; read: ReadPhase };
type HandleState = { retired: boolean; handles: [ReaderHandle, ReaderHandle] };
type HandleEvent =
  | { kind: 'observe' | 'cancel-observer'; handle: ObserverId; observer: ObserverId }
  | { kind: 'close-handle' | 'read' | 'read-result'; handle: ObserverId }
  | { kind: 'retire' };
function handleEvents(state: HandleState): HandleEvent[] {
  const events: HandleEvent[] = [];
  for (const handle of observerIds) {
    const held = state.handles[handle];
    if (held.open) events.push({ kind: 'close-handle', handle });
    if (held.read === 'unused') events.push({ kind: 'read', handle });
    if (held.read === 'pending') events.push({ kind: 'read-result', handle });
    for (const observer of observerIds) {
      if (held.open && held.observers[observer] === 'unused')
        events.push({ kind: 'observe', handle, observer });
      if (held.observers[observer] === 'live')
        events.push({ kind: 'cancel-observer', handle, observer });
    }
  }
  if (!state.retired) events.push({ kind: 'retire' });
  return events;
}
function handleStep(state: HandleState, event: HandleEvent): HandleState {
  const next: HandleState = {
    retired: state.retired,
    handles: state.handles.map((handle) => ({
      ...handle,
      observers: [...handle.observers],
    })) as HandleState['handles'],
  };
  if (event.kind === 'retire') {
    next.retired = true;
    for (const handle of next.handles) {
      handle.open = false;
      handle.observers = handle.observers.map((observer) =>
        observer === 'live' ? 'ended' : observer
      ) as ReaderHandle['observers'];
    }
  } else {
    const handle = next.handles[event.handle];
    if (event.kind === 'observe') handle.observers[event.observer] = 'live';
    else if (event.kind === 'cancel-observer') handle.observers[event.observer] = 'ended';
    else if (event.kind === 'close-handle') {
      handle.open = false;
      handle.observers = handle.observers.map((observer) =>
        observer === 'live' ? 'ended' : observer
      ) as ReaderHandle['observers'];
    } else if (event.kind === 'read') handle.read = handle.open ? 'pending' : 'closed';
    else handle.read = handle.open ? 'published' : 'closed';
  }
  return next;
}
const handleWitnesses = {
  allChildObserversEnd: 0,
  otherHandleUnaffected: 0,
  observerCancelRetainsReader: 0,
  lateReadFenced: 0,
  closedReadRejected: 0,
};
const handleCheck = explore(
  {
    retired: false,
    handles: [
      { open: true, observers: ['unused', 'unused'], read: 'unused' },
      { open: true, observers: ['unused', 'unused'], read: 'unused' },
    ],
  } as HandleState,
  handleEvents,
  handleStep,
  (before, event, after) => {
    for (const handle of after.handles) {
      assert(
        !handle.observers.includes('live') || handle.open,
        'HANDLE-1: live observation always has a usable reader handle'
      );
      assert(!after.retired || !handle.open, 'HANDLE-1: workspace retirement closes all readers');
    }
    if (event.kind === 'close-handle') {
      const other: ObserverId = event.handle === 0 ? 1 : 0;
      assert(
        JSON.stringify(before.handles[other]) === JSON.stringify(after.handles[other]),
        'HANDLE-1: closing one handle leaves the other unchanged'
      );
      if (before.handles[other].open) handleWitnesses.otherHandleUnaffected++;
      if (before.handles[event.handle].observers.every((observer) => observer === 'live')) {
        assert(
          after.handles[event.handle].observers.every((observer) => observer === 'ended'),
          'HANDLE-1: all child observations end even with separate execution Scopes'
        );
        handleWitnesses.allChildObserversEnd++;
      }
    }
    if (event.kind === 'cancel-observer') {
      assert(
        after.handles[event.handle].open,
        'HANDLE-1: one observer cancellation retains its reader'
      );
      handleWitnesses.observerCancelRetainsReader++;
    }
    if (
      (event.kind === 'read' || event.kind === 'read-result') &&
      !before.handles[event.handle].open
    ) {
      assert(
        after.handles[event.handle].read === 'closed',
        'HANDLE-1: closed handle cannot read/publish late results'
      );
      if (event.kind === 'read') handleWitnesses.closedReadRejected++;
      else handleWitnesses.lateReadFenced++;
    }
  },
  6
);
assert(
  Object.values(handleWitnesses).every((count) => count > 0),
  'Handle witnesses covered'
);

// A bridge decision matrix with two views, one pending read and scalar page/fact values.
// It checks source replacement policy, not the real View, range/pin rebinding or scheduler.
type BridgeReason = 'reset' | 'unavailable' | 'denied' | 'closed' | 'permanent';
type BridgeReplyKind = 'body' | 'page' | 'fact' | 'change';
type Bridge = {
  identity: string;
  epoch: number;
  phase: 'loading' | 'live' | 'reconnecting' | 'failed' | 'retired';
  observer: boolean;
  pendingInitial: boolean;
  failures: number;
  canRetry: boolean;
  contentGeneration: number;
  directory: string;
  body: string | null;
  fact: string | null;
  cursor: string | null;
  stale: boolean;
  wantedTurn: string;
  rangeIntent: [number, number];
  draft: string;
};
const makeBridge = (identity: string): Bridge => ({
  identity,
  epoch: 1,
  phase: 'loading',
  observer: true,
  pendingInitial: true,
  failures: 0,
  canRetry: true,
  contentGeneration: 0,
  directory: '',
  body: null,
  fact: null,
  cursor: null,
  stale: false,
  wantedTurn: 'synthetic-turn',
  rangeIntent: [0, 1],
  draft: 'synthetic-local-draft',
});
function acceptBridgeInitial(bridge: Bridge, epoch: number, value: string): void {
  if (
    epoch !== bridge.epoch ||
    !bridge.pendingInitial ||
    !bridge.observer ||
    !['loading', 'reconnecting'].includes(bridge.phase)
  )
    return;
  bridge.directory = value;
  bridge.cursor = `${epoch}:${value}`;
  bridge.body = null;
  bridge.fact = null;
  bridge.contentGeneration++;
  bridge.pendingInitial = false;
  bridge.phase = 'live';
  bridge.stale = false;
  bridge.failures = 0;
}
function interruptBridge(bridge: Bridge, reason: BridgeReason): void {
  if (bridge.phase === 'retired' || bridge.phase === 'failed') return;
  bridge.epoch++;
  bridge.observer = false;
  bridge.pendingInitial = false;
  bridge.stale = bridge.directory !== '';
  if (reason === 'denied' || reason === 'closed') {
    bridge.phase = 'retired';
    bridge.canRetry = false;
    // The abstract cache is inaccessible; actual retention/cleanup follows product policy.
  } else if (reason === 'permanent') {
    bridge.phase = 'failed';
    bridge.canRetry = false;
  } else {
    bridge.failures++;
    bridge.phase = bridge.failures >= 2 ? 'failed' : 'reconnecting';
  }
}
function bridgeRetrySignal(bridge: Bridge): void {
  // Explicit readiness/clock signal, not real time. Repeated signals are single-flight.
  if (bridge.phase !== 'reconnecting' || bridge.pendingInitial || !bridge.canRetry) return;
  bridge.pendingInitial = true;
  bridge.observer = true;
}
function bridgeManualRetry(bridge: Bridge, bindingCurrent: boolean): void {
  if (bridge.phase !== 'failed' || !bridge.canRetry || !bindingCurrent) return;
  bridge.epoch++;
  bridge.failures = 0;
  bridge.phase = 'reconnecting';
}
function releaseBridge(bridge: Bridge): void {
  bridge.epoch++;
  bridge.phase = 'retired';
  bridge.canRetry = false;
  bridge.observer = false;
  bridge.pendingInitial = false;
}
function publishBridgeReply(
  bridge: Bridge,
  epoch: number,
  generation: number,
  kind: BridgeReplyKind,
  value: string
): void {
  if (bridge.phase !== 'live' || epoch !== bridge.epoch || generation !== bridge.contentGeneration)
    return;
  if (kind === 'body') bridge.body = value;
  else if (kind === 'fact') bridge.fact = value;
  else if (kind === 'page') bridge.cursor = value;
  else {
    bridge.contentGeneration++;
    bridge.body = null;
    bridge.fact = null;
  }
}
const recoveryWitnesses = {
  newInitialRestoresReader: 0,
  staleReplyFenced: 0,
  otherViewUnaffected: 0,
  terminalCannotRetry: 0,
  releasedCannotRevive: 0,
  sourceClearsBodyAndFacts: 0,
  intentRetained: 0,
  retryBudgetExhausted: 0,
  initialResetHandled: 0,
  sameSourceLateReadFenced: 0,
  explicitRetryChecksBinding: 0,
};
let recoveryMatrixCases = 0;
for (const reason of ['reset', 'unavailable', 'denied', 'closed', 'permanent'] as const) {
  for (const releaseAt of ['none', 'before-retry', 'during-initial', 'after-initial'] as const) {
    for (const lateAfterInitial of [false, true]) {
      for (const kind of ['body', 'page', 'fact', 'change'] as const) {
        const view = makeBridge('stable-view-a');
        const other = makeBridge('stable-view-b');
        acceptBridgeInitial(view, 1, 'old-directory');
        acceptBridgeInitial(other, 1, 'other-directory');
        view.body = 'old-body';
        view.fact = 'old-fact';
        const otherBefore = JSON.stringify(other);
        const oldEpoch = view.epoch;
        const oldGeneration = view.contentGeneration;
        interruptBridge(view, reason);
        assert(
          !['live'].includes(view.phase),
          'VIEW-1: interruption is visible after a successful initial'
        );
        if (releaseAt === 'before-retry') releaseBridge(view);
        bridgeRetrySignal(view);
        const pendingBefore = JSON.stringify(view);
        bridgeRetrySignal(view);
        assert(
          JSON.stringify(view) === pendingBefore,
          'VIEW-1: repeated retry signals do not duplicate an acquisition'
        );
        if (releaseAt === 'during-initial') releaseBridge(view);
        const freshEpoch = view.epoch;
        if (!lateAfterInitial) {
          const before = JSON.stringify(view);
          publishBridgeReply(view, oldEpoch, oldGeneration, kind, 'late-old-result');
          acceptBridgeInitial(view, oldEpoch, 'late-old-initial');
          assert(
            JSON.stringify(view) === before,
            'VIEW-1: old replies cannot change reconnecting/terminal state'
          );
        }
        acceptBridgeInitial(view, freshEpoch, 'fresh-directory');
        if (view.phase === 'live') {
          assert(
            view.body === null && view.fact === null && view.cursor?.startsWith(`${freshEpoch}:`),
            'VIEW-1: fresh source has no old body/facts/cursor'
          );
          recoveryWitnesses.sourceClearsBodyAndFacts++;
          publishBridgeReply(view, view.epoch, view.contentGeneration, 'body', 'fresh-body');
          assert(view.body === 'fresh-body', 'VIEW-1: fresh source has a usable reader');
          recoveryWitnesses.newInitialRestoresReader++;
        }
        if (releaseAt === 'after-initial') releaseBridge(view);
        if (lateAfterInitial) {
          const before = JSON.stringify(view);
          publishBridgeReply(view, oldEpoch, oldGeneration, kind, 'late-old-result');
          acceptBridgeInitial(view, oldEpoch, 'late-old-initial');
          assert(
            JSON.stringify(view) === before,
            'VIEW-1: late old replies cannot overwrite the new source'
          );
        }
        recoveryWitnesses.staleReplyFenced++;
        if (view.phase === 'failed' || view.phase === 'retired') {
          const before = JSON.stringify(view);
          bridgeRetrySignal(view);
          acceptBridgeInitial(view, view.epoch, 'terminal-result');
          assert(
            JSON.stringify(view) === before,
            'VIEW-2: terminal sources cannot retry or revive'
          );
          if (releaseAt !== 'none') recoveryWitnesses.releasedCannotRevive++;
          else recoveryWitnesses.terminalCannotRetry++;
        }
        assert(
          view.identity === 'stable-view-a' &&
            view.wantedTurn === 'synthetic-turn' &&
            view.draft === 'synthetic-local-draft' &&
            view.rangeIntent[0] === 0 &&
            view.rangeIntent[1] === 1,
          'VIEW-1: view identity and UI intent survive source replacement'
        );
        recoveryWitnesses.intentRetained++;
        assert(
          JSON.stringify(other) === otherBefore,
          'VIEW-1: one bridge reset does not retire another view'
        );
        recoveryWitnesses.otherViewUnaffected++;
        recoveryMatrixCases++;
      }
    }
  }
}
for (const initiallyLive of [false, true]) {
  const view = makeBridge('budget-view');
  if (initiallyLive) acceptBridgeInitial(view, 1, 'first-directory');
  interruptBridge(view, 'reset');
  bridgeRetrySignal(view);
  const abandonedEpoch = view.epoch;
  interruptBridge(view, 'reset');
  const before = JSON.stringify(view);
  bridgeRetrySignal(view);
  acceptBridgeInitial(view, abandonedEpoch, 'late-failed-attempt');
  assert(
    view.phase === 'failed' && !view.observer && JSON.stringify(view) === before,
    'VIEW-2: consecutive initialization failures stop automatic retry'
  );
  recoveryWitnesses.retryBudgetExhausted++;
  if (!initiallyLive) recoveryWitnesses.initialResetHandled++;
  recoveryMatrixCases++;
}
for (const bindingCurrent of [false, true]) {
  const view = makeBridge('manual-retry-view');
  interruptBridge(view, 'reset');
  bridgeRetrySignal(view);
  interruptBridge(view, 'reset');
  const before = JSON.stringify(view);
  bridgeManualRetry(view, bindingCurrent);
  bridgeRetrySignal(view);
  acceptBridgeInitial(view, view.epoch, 'manual-retry-directory');
  if (bindingCurrent) {
    assert(
      view.phase === 'live' && view.failures === 0,
      'VIEW-2: explicit retry can rebuild a retryable current binding'
    );
  } else {
    assert(
      JSON.stringify(view) === before,
      'VIEW-2: explicit retry cannot reuse a retired binding'
    );
  }
  recoveryWitnesses.explicitRetryChecksBinding++;
  recoveryMatrixCases++;
}
{
  const view = makeBridge('same-source-view');
  acceptBridgeInitial(view, 1, 'directory');
  const generation = view.contentGeneration;
  publishBridgeReply(view, 1, generation, 'change', 'invalidate');
  publishBridgeReply(view, 1, generation, 'body', 'stale-before-change');
  assert(view.body === null, 'VIEW-1: per-turn generation fences late reads within one source');
  recoveryWitnesses.sameSourceLateReadFenced++;
  recoveryMatrixCases++;
}
assert(
  Object.values(recoveryWitnesses).every((count) => count > 0),
  'Recovery witnesses covered'
);

console.log(
  JSON.stringify(
    {
      validation:
        'bounded abstract-state exploration plus finite decision matrices; not product tests or implementation proof',
      bounds: {
        observers: 2,
        perObserverUpdateCapacity: [1, 2],
        publishedUpdates: 4,
        generationRequests: 2,
        authGenerations: 2,
        ownerGenerations: 2,
        commands: 1,
        sessionHandles: 2,
        observersPerSessionHandle: 2,
        traceDepth: 6,
      },
      observation: observationChecks,
      generations: { ...generationCheck.stats, staleAuthResults, staleOwnerResults },
      command: { ...commandCheck.stats, witnesses: commandWitnesses },
      sessionHandle: { ...handleCheck.stats, witnesses: handleWitnesses },
      decisionMatrices: {
        validation:
          'exhaustively checked over declared finite directory/backend/editor/recovery domains',
        bounds: {
          initialDirectoryRows: 3,
          maximumDirectoryRows: 4,
          directoryEventFixtures: directoryFixtures.length,
          directoryEventsPerQuery: 1,
          pageLimits: [1, 2],
          archiveFilters: 3,
          projectFilters: 3,
          parentFilters: 4,
          sortOrders: 2,
          bootstrapEventFixtures: 3,
          bootstrapOrderings: 2,
          backendMarkers: ['missing', 'loro', 'roost', 'unknown'],
          hydrationStates: 2,
          roostAdapterAvailabilityStates: 2,
          creationFlagStates: 2,
          editorTransports: ['stdio', 'http'],
          secretActions: ['omit', 'keep', 'replace', 'empty', 'clear'],
          concurrentEditorChanges: ['none', 'name', 'credential', 'unrelated', 'target'],
          recoveryViews: 2,
          recoveryReasons: ['reset', 'unavailable', 'denied', 'closed', 'permanent'],
          releaseStages: ['none', 'before-retry', 'during-initial', 'after-initial'],
          staleReplyKinds: ['body', 'page', 'fact', 'change'],
          staleReplyOrderings: 2,
          consecutiveFailureLimit: 2,
        },
        directory: { cases: directoryMatrixCases, witnesses: directoryWitnesses },
        bootstrap: { cases: bootstrapMatrixCases, witnesses: bootstrapWitnesses },
        backend: { cases: backendMatrixCases, witnesses: backendWitnesses },
        editor: { cases: editorMatrixCases, witnesses: editorWitnesses },
        viewRecovery: { cases: recoveryMatrixCases, witnesses: recoveryWitnesses },
      },
    },
    null,
    2
  )
);
