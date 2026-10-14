/** Internal synthetic fixture/IPC DTO; not a public wire, recovery vault or
 * trusted production checkpoint store. The parent owns this channel/selection. */
export interface LabProcessConfiguration {
  readonly syntheticOnly: true;
  readonly device: string;
  readonly peerSigningKey: string;
  readonly baseUrl: string;
  readonly directory: string;
  readonly actor: 'owner' | 'peer';
  readonly mode: 'create' | 'open';
  readonly genesis: string;
  readonly records: readonly string[];
  readonly localPoint?: { readonly head: string; readonly length: number };
  readonly point: { readonly head: string; readonly length: number };
}
