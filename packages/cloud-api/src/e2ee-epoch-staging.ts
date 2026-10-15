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
export type StageEpochGroupRequest = EpochStagingWorkspaceRequest & {
  readonly group: EpochStagedGroupDto;
};
export type ReadEpochGroupRequest = EpochStagingWorkspaceRequest & {
  readonly key: EpochStagedGroupKeyDto;
};
export type DeleteEpochGroupRequest = ReadEpochGroupRequest & {
  /** Independently verified occupied slot; never a server-selected checkpoint. */
  readonly occupied: { readonly epoch: number; readonly commitment: string };
};
