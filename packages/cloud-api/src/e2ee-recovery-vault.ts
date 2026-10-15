/** Opaque encrypted recovery storage. Authentication gates cloud access; it never
 * decrypts, chooses ledger trust, or proves that a Recovery device is active. */
export type RecoveryVaultCiphertextDto = {
  readonly entryId: string;
  readonly revision: number;
  readonly ciphertext: string;
};
export type RecoveryVaultPutRequest = {
  readonly vaultId: string;
  readonly entry: RecoveryVaultCiphertextDto;
};
export type RecoveryVaultReadRequest = {
  readonly vaultId: string;
  readonly entryId: string;
};
export type RecoveryVaultIndexReadRequest = {
  readonly vaultId: string;
};
export type RecoveryVaultIndexCasRequest = {
  readonly vaultId: string;
  readonly expected: { readonly revision: number; readonly digest: string } | null;
  readonly next: RecoveryVaultCiphertextDto;
  /** Opaque ids only; checked for existence in the same index-CAS transaction. */
  readonly referencedEntryIds: readonly string[];
};
export type RecoveryVaultIndexCasReply = {
  readonly outcome: 'Committed' | 'Conflict';
};
export type RecoveryVaultDeleteRequest = {
  readonly vaultId: string;
  readonly entryId: string;
  readonly expectedIndex: { readonly revision: number; readonly digest: string };
};
