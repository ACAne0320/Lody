import { Flock } from '@loro-dev/flock-wasm';
import { createFlockAdapter } from '@loro-dev/streams-crdt/flock';
import type { makeStreamsUpdateBinding } from '@lody/e2ee-core/content/streams';
import { makeLabDocumentSession } from './document-session';
export { LabContentError as LabFlockContentError } from './document-session';
/** Flock has no deterministic free/dispose; drop references only after actual SDK
 * settlement. Inject a logical clock; reopens must retain its monotonic semantics. */
export function makeLabFlockSession(
  input: Omit<Parameters<typeof makeStreamsUpdateBinding>[0], 'model'> & {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly streamUrl: string;
    readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
    readonly replica: string;
    readonly now: () => number;
  }
) {
  const replica = input.replica,
    now = input.now;
  return makeLabDocumentSession({ ...input, model: 'flock' }, () => {
    let value: Flock | undefined = new Flock(replica);
    const current = () => {
      if (!value) throw new Error('flock-closed');
      return value;
    };
    return {
      adapter: () => createFlockAdapter(current()),
      exportSnapshot: () => current().exportFile(),
      importSnapshot: (bytes) => {
        value = Flock.fromFile(bytes, replica);
      },
      append: (text) => {
        const old = current().get(['text']);
        if (old !== undefined && typeof old !== 'string') throw new Error('flock-state');
        const time = now();
        if (!Number.isSafeInteger(time) || time < 0) throw new Error('flock-clock');
        current().put(['text'], (old ?? '') + text, time);
      },
      text: () => {
        const text = current().get(['text']);
        if (text === undefined) return '';
        if (typeof text !== 'string') throw new Error('flock-state');
        return text;
      },
      release: () => {
        value = undefined;
      },
    };
  });
}
