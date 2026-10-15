import type { Effect } from 'effect';
/** Content-blind Streams metadata. Tokens remain opaque to this consumer;
 * only the backend can decide their ordering and record alignment. */
export interface StreamsRecordBoundary {
  readonly offset: string;
  readonly boundary: boolean;
  readonly notAfterHead: boolean;
  readonly head: string;
}
export interface StreamsRecordBoundaryPort {
  readonly query: (input: {
    readonly stream: string;
    readonly offset: string;
  }) => Effect.Effect<StreamsRecordBoundary, unknown>;
}
