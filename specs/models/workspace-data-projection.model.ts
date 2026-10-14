// Earlier general-splice read-projection candidate; not the selected IPC contract.
// The current design compares narrow append/item projection with memory-only Loro.
// This model validates neither candidate's real codec, SDK integration or budget.
// Run with Node 24 strip-types. Pure state/byte checks, no network or wall clock.
// Models two text fields, sequential UTF-16 splices, one source generation switch,
// duplicate/gap/old-source frames and append-only doubling checkpoints.
// Excludes item/list/scalar codecs, actual Loro/Roost diffs, IPC chunk assembly,
// auth/transport enforcement, scheduling, frame headers and UI memory/latency.

function assertProjection(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type FieldId = 'text' | 'thought';
type Projection = {
  sourceEpoch: number;
  turnId: string;
  generation: number;
  revision: number;
  fields: Record<FieldId, string>;
};
type TextSplice = {
  fieldId: FieldId;
  offsetUtf16: number;
  deleteUtf16: number;
  insert: string;
};
type TextDelta = Omit<Projection, 'fields'> & {
  baseRevision: number;
  edits: readonly TextSplice[];
};
type Delivery = 'applied' | 'ignored' | 'snapshot-required';
type Receiver = { projection: Projection; snapshotRequired: boolean };

function copyProjection(source: Projection): Projection {
  return { ...source, fields: { ...source.fields } };
}

function projectionHeader(source: Omit<Projection, 'fields'>): Omit<Projection, 'fields'> {
  return {
    sourceEpoch: source.sourceEpoch,
    turnId: source.turnId,
    generation: source.generation,
    revision: source.revision,
  };
}

function receiveDelta(receiver: Receiver, frame: TextDelta): Delivery {
  const current = receiver.projection;
  if (
    frame.sourceEpoch !== current.sourceEpoch ||
    frame.turnId !== current.turnId ||
    frame.generation < current.generation
  )
    return 'ignored';
  if (frame.generation === current.generation && frame.revision <= current.revision)
    return 'ignored';
  if (
    receiver.snapshotRequired ||
    frame.generation !== current.generation ||
    frame.baseRevision !== current.revision ||
    frame.revision <= frame.baseRevision
  ) {
    receiver.snapshotRequired = true;
    return 'snapshot-required';
  }
  const next = copyProjection(current);
  for (const edit of frame.edits) {
    const value = next.fields[edit.fieldId];
    if (
      typeof value !== 'string' ||
      !Number.isSafeInteger(edit.offsetUtf16) ||
      !Number.isSafeInteger(edit.deleteUtf16) ||
      edit.offsetUtf16 < 0 ||
      edit.deleteUtf16 < 0 ||
      edit.offsetUtf16 + edit.deleteUtf16 > value.length
    ) {
      receiver.snapshotRequired = true;
      return 'snapshot-required';
    }
    next.fields[edit.fieldId] =
      value.slice(0, edit.offsetUtf16) +
      edit.insert +
      value.slice(edit.offsetUtf16 + edit.deleteUtf16);
  }
  next.revision = frame.revision;
  receiver.projection = next;
  return 'applied';
}

function receiveSnapshot(receiver: Receiver, snapshot: Projection): Delivery {
  const current = receiver.projection;
  if (
    snapshot.sourceEpoch !== current.sourceEpoch ||
    snapshot.turnId !== current.turnId ||
    snapshot.generation < current.generation ||
    (snapshot.generation === current.generation && snapshot.revision < current.revision)
  )
    return 'ignored';
  receiver.projection = copyProjection(snapshot);
  receiver.snapshotRequired = false;
  return 'applied';
}

function reobserve(receiver: Receiver): void {
  receiver.projection = {
    ...receiver.projection,
    sourceEpoch: receiver.projection.sourceEpoch + 1,
  };
  receiver.snapshotRequired = true;
}

const initialProjection = (): Projection => ({
  sourceEpoch: 1,
  turnId: 'synthetic-turn',
  generation: 1,
  revision: 0,
  fields: { text: '', thought: '' },
});
const witnesses = {
  sequentialSplices: 0,
  unicodeRoundTrip: 0,
  duplicateIgnored: 0,
  gapRequiresSnapshot: 0,
  snapshotRestores: 0,
  oldEpochIgnored: 0,
  oldGenerationIgnored: 0,
  newerGenerationRequiresSnapshot: 0,
  atomicRejectedBatch: 0,
  gapFencesOldSnapshots: 0,
  coalescedRevisionJump: 0,
};
let projectionCases = 0;
const tokens = ['a', '中文', '😀', '\n"'] as const;
for (const firstField of ['text', 'thought'] as const) {
  for (const first of tokens) {
    for (const secondField of ['text', 'thought'] as const) {
      for (const second of tokens) {
        for (const operation of ['append', 'prepend', 'replace', 'delete'] as const) {
          const source = initialProjection();
          const receiver: Receiver = { projection: initialProjection(), snapshotRequired: false };
          const firstFrame: TextDelta = {
            ...projectionHeader(source),
            baseRevision: 0,
            revision: 1,
            edits: [{ fieldId: firstField, offsetUtf16: 0, deleteUtf16: 0, insert: first }],
          };
          source.fields[firstField] = first;
          source.revision = 1;
          assertProjection(
            receiveDelta(receiver, firstFrame) === 'applied',
            'PROJ-1: first splice applied'
          );
          const prior = source.fields[secondField];
          const nextText =
            operation === 'append'
              ? prior + second
              : operation === 'prepend'
                ? second + prior
                : operation === 'replace'
                  ? second
                  : '';
          const edit: TextSplice = {
            fieldId: secondField,
            offsetUtf16: operation === 'append' ? prior.length : 0,
            deleteUtf16: operation === 'replace' || operation === 'delete' ? prior.length : 0,
            insert: operation === 'delete' ? '' : second,
          };
          const secondFrame: TextDelta = {
            ...projectionHeader(source),
            baseRevision: 1,
            revision: 2,
            edits: [edit],
          };
          source.fields[secondField] = nextText;
          source.revision = 2;
          assertProjection(
            receiveDelta(receiver, secondFrame) === 'applied',
            'PROJ-1: next splice applied'
          );
          assertProjection(
            JSON.stringify(receiver.projection) === JSON.stringify(source),
            'PROJ-1: projection equals authoritative synthetic fields after sequential edits'
          );
          witnesses.sequentialSplices++;
          if (first === '😀' || second === '😀') witnesses.unicodeRoundTrip++;
          const after = JSON.stringify(receiver);
          assertProjection(
            receiveDelta(receiver, secondFrame) === 'ignored' && JSON.stringify(receiver) === after,
            'PROJ-2: replay does not append twice'
          );
          witnesses.duplicateIgnored++;
          const gapped: Receiver = { projection: initialProjection(), snapshotRequired: false };
          assertProjection(
            receiveDelta(gapped, secondFrame) === 'snapshot-required' &&
              gapped.projection.fields.text === '' &&
              gapped.projection.fields.thought === '',
            'PROJ-2: missing base cannot apply a delta'
          );
          witnesses.gapRequiresSnapshot++;
          reobserve(gapped);
          const beforeLateSnapshot = JSON.stringify(gapped);
          assertProjection(
            receiveSnapshot(gapped, initialProjection()) === 'ignored' &&
              JSON.stringify(gapped) === beforeLateSnapshot,
            'PROJ-2: reset fences an old initial result'
          );
          witnesses.gapFencesOldSnapshots++;
          const checkpoint = { ...source, sourceEpoch: gapped.projection.sourceEpoch };
          assertProjection(
            receiveSnapshot(gapped, checkpoint) === 'applied' &&
              !gapped.snapshotRequired &&
              JSON.stringify(gapped.projection) === JSON.stringify(checkpoint),
            'PROJ-2: checkpoint restores exact state'
          );
          witnesses.snapshotRestores++;
          projectionCases++;
        }
      }
    }
  }
}

for (const fieldId of ['text', 'thought'] as const) {
  for (const first of tokens) {
    for (const second of tokens) {
      const receiver: Receiver = { projection: initialProjection(), snapshotRequired: false };
      const frame: TextDelta = {
        ...projectionHeader(receiver.projection),
        baseRevision: 0,
        revision: 2,
        edits: [
          { fieldId, offsetUtf16: 0, deleteUtf16: 0, insert: first },
          { fieldId, offsetUtf16: first.length, deleteUtf16: 0, insert: second },
        ],
      };
      assertProjection(
        receiveDelta(receiver, frame) === 'applied' &&
          receiver.projection.fields[fieldId] === first + second &&
          receiver.projection.revision === 2,
        'PROJ-1: coalesced revisions apply all sequential edits from the declared base'
      );
      witnesses.coalescedRevisionJump++;
      projectionCases++;
    }
  }
}

for (const stale of ['epoch', 'turn', 'generation'] as const) {
  const receiver: Receiver = { projection: initialProjection(), snapshotRequired: false };
  receiver.projection.sourceEpoch = 2;
  receiver.projection.generation = 2;
  const frame: TextDelta = {
    ...projectionHeader(receiver.projection),
    baseRevision: 0,
    revision: 1,
    edits: [{ fieldId: 'text', offsetUtf16: 0, deleteUtf16: 0, insert: 'stale' }],
  };
  if (stale === 'epoch') frame.sourceEpoch = 1;
  else if (stale === 'turn') frame.turnId = 'other-turn';
  else frame.generation = 1;
  const before = JSON.stringify(receiver);
  assertProjection(
    receiveDelta(receiver, frame) === 'ignored' && JSON.stringify(receiver) === before,
    'PROJ-3: late source/turn/generation cannot change current projection'
  );
  const snapshot: Projection = { ...projectionHeader(frame), fields: { text: 'old', thought: '' } };
  assertProjection(
    receiveSnapshot(receiver, snapshot) === 'ignored' && JSON.stringify(receiver) === before,
    'PROJ-3: late snapshot cannot replace current source'
  );
  if (stale === 'generation') witnesses.oldGenerationIgnored++;
  else witnesses.oldEpochIgnored++;
  projectionCases++;
}

{
  const receiver: Receiver = { projection: initialProjection(), snapshotRequired: false };
  const frame: TextDelta = {
    ...projectionHeader(receiver.projection),
    generation: 2,
    baseRevision: 0,
    revision: 1,
    edits: [{ fieldId: 'text', offsetUtf16: 0, deleteUtf16: 0, insert: 'new' }],
  };
  assertProjection(
    receiveDelta(receiver, frame) === 'snapshot-required' && receiver.projection.generation === 1,
    'PROJ-3: a new shape generation first needs its mapping checkpoint'
  );
  witnesses.newerGenerationRequiresSnapshot++;
  projectionCases++;
}

for (const invalid of ['negative', 'past-end', 'fractional'] as const) {
  const receiver: Receiver = { projection: initialProjection(), snapshotRequired: false };
  const before = JSON.stringify(receiver.projection);
  const frame: TextDelta = {
    ...projectionHeader(receiver.projection),
    baseRevision: 0,
    revision: 1,
    edits: [
      { fieldId: 'text', offsetUtf16: 0, deleteUtf16: 0, insert: 'valid-first' },
      {
        fieldId: 'thought',
        offsetUtf16: invalid === 'negative' ? -1 : invalid === 'fractional' ? 0.5 : 1,
        deleteUtf16: 0,
        insert: 'invalid-second',
      },
    ],
  };
  assertProjection(
    receiveDelta(receiver, frame) === 'snapshot-required' &&
      JSON.stringify(receiver.projection) === before,
    'PROJ-1: invalid batch publishes no partial body'
  );
  witnesses.atomicRejectedBatch++;
  projectionCases++;
}

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const costCases: {
  updates: number;
  tokenBytes: number;
  deltaBodyBytes: number;
  checkpointBytes: number;
  fullRereadBytes: number;
}[] = [];
for (const token of ['a', '中文', '😀']) {
  for (const updates of [16, 32, 64, 128, 512, 1024, 4096]) {
    let source = '';
    let lastCheckpointBytes = 0;
    let checkpointBytes = 0;
    let deltaBodyBytes = 0;
    let fullRereadBytes = 0;
    for (let count = 0; count < updates; count++) {
      source += token;
      deltaBodyBytes += bytes(token);
      const size = bytes(source);
      fullRereadBytes += size;
      if (lastCheckpointBytes === 0 || size >= lastCheckpointBytes * 2) {
        checkpointBytes += size;
        lastCheckpointBytes = size;
      }
    }
    const finalBytes = bytes(source);
    assertProjection(
      deltaBodyBytes === finalBytes,
      'COST-1: inserts transfer each new body byte once'
    );
    assertProjection(
      checkpointBytes < finalBytes * 2,
      'COST-1: doubling checkpoints have a linear body bound'
    );
    assertProjection(
      fullRereadBytes === (bytes(token) * updates * (updates + 1)) / 2,
      'COST-1: full rereads transfer quadratic body bytes'
    );
    costCases.push({
      updates,
      tokenBytes: bytes(token),
      deltaBodyBytes,
      checkpointBytes,
      fullRereadBytes,
    });
  }
}
assertProjection(
  Object.values(witnesses).every((count) => count > 0),
  'Projection witnesses covered'
);
console.log(
  JSON.stringify(
    {
      validation:
        'finite proposed read-projection and append-only body-cost rules; not actual SDK/IPC/performance acceptance',
      bounds: {
        textFields: 2,
        insertTokens: 4,
        normalEdits: 2,
        sourceEpochs: 2,
        shapeGenerations: 2,
        maximumAppendUpdates: 4096,
        excludesFrameAndCheckpointMetadataBytes: true,
      },
      projectionCases,
      witnesses,
      costCases,
    },
    null,
    2
  )
);
