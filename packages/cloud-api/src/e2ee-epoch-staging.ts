/** Optional cloud storage DTOs. These are opaque encrypted originals, not ledger
 * authority, membership proofs or a new commit point. All hex is lowercase. */
export type EpochStagedGroupKeyDto = {
  readonly genesis: string;
  readonly epoch: number;
  readonly commitment: string;
  readonly recordHash: string;
};
export type EpochStagedEnvelopeDto = {
  readonly recipient: string;
  readonly frameHex: string;
};
export type EpochStagedGroupDto = EpochStagedGroupKeyDto & {
  readonly recordHex: string;
  readonly envelopes: readonly EpochStagedEnvelopeDto[];
};
export type EpochStagingWorkspaceRequest = {
  readonly workspaceId: string;
  /** Optional CLI credential; an app session otherwise supplies account identity. */
  readonly cliToken?: string;
};
/** Device possession is distinct from app/CLI account membership. */
export type EpochStagingRequestProofDto = {
  readonly signer: string;
  readonly signature: string;
};
export type StageEpochGroupRequest = EpochStagingWorkspaceRequest & {
  readonly group: EpochStagedGroupDto;
  readonly proof: EpochStagingRequestProofDto;
};
export type ReadEpochGroupRequest = EpochStagingWorkspaceRequest & {
  readonly key: EpochStagedGroupKeyDto;
};
export type DeleteEpochGroupRequest = ReadEpochGroupRequest & {
  /** Independently verified occupied slot; never a server-selected checkpoint. */
  readonly occupied: { readonly epoch: number; readonly commitment: string };
  readonly proof: EpochStagingRequestProofDto;
};

/** Exact device request bytes, not a ledger or account authorization proof.
 * Fixed tuples avoid property order and separator aliases. Credentials and the
 * signature itself are deliberately excluded. Stage binds every original. */
export function epochStagingRequestSigningBytes(
  input:
    | {
        readonly operation: 'stage';
        readonly workspaceId: string;
        readonly group: EpochStagedGroupDto;
      }
    | {
        readonly operation: 'delete';
        readonly workspaceId: string;
        readonly key: EpochStagedGroupKeyDto;
        readonly occupied: { readonly epoch: number; readonly commitment: string };
      }
): Uint8Array {
  const invalid = () => {
    throw new TypeError('invalid epoch staging request');
  };
  const hash = (value: string) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const hex = (value: string, max: number) =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max * 2 &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/.test(value);
  if (
    !input ||
    typeof input.workspaceId !== 'string' ||
    !input.workspaceId.length ||
    input.workspaceId.length > 256
  )
    return invalid();
  const key =
    input.operation === 'stage'
      ? input.group
      : input.operation === 'delete'
        ? input.key
        : invalid();
  if (
    !key ||
    !hash(key.genesis) ||
    !hash(key.commitment) ||
    !hash(key.recordHash) ||
    !Number.isInteger(key.epoch) ||
    key.epoch < 1 ||
    key.epoch > 0xffffffff
  )
    return invalid();
  const tuple: unknown[] = [
    input.operation,
    input.workspaceId,
    key.genesis,
    key.epoch,
    key.commitment,
    key.recordHash,
  ];
  if (input.operation === 'stage') {
    const group = input.group;
    if (
      !hex(group.recordHex, 8192) ||
      !Array.isArray(group.envelopes) ||
      group.envelopes.length < 1 ||
      group.envelopes.length > 4096
    )
      return invalid();
    const seen = new Set<string>();
    const rows: [string, string][] = [];
    const count = group.envelopes.length;
    for (let index = 0; index < count; index++) {
      const row = group.envelopes[index];
      if (!row || !hash(row.recipient) || !hex(row.frameHex, 512) || seen.has(row.recipient))
        return invalid();
      seen.add(row.recipient);
      rows.push([row.recipient, row.frameHex]);
    }
    if (group.envelopes.length !== count) return invalid();
    rows.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    tuple.push(group.recordHex, rows);
  } else {
    const occupied = input.occupied;
    if (
      !occupied ||
      occupied.epoch !== key.epoch ||
      !hash(occupied.commitment) ||
      occupied.commitment === key.commitment
    )
      return invalid();
    tuple.push(occupied.epoch, occupied.commitment);
  }
  return new TextEncoder().encode('lody-e2ee/epoch-staging-request/v1\0' + JSON.stringify(tuple));
}
