import { LoroDoc } from 'loro-crdt';
import { createLoroDocAdapter } from '@loro-dev/streams-crdt/loro';
import type { makeStreamsUpdateBinding } from '@lody/e2ee-core/content/streams';
import { makeLabDocumentSession } from './document-session';
export { LabContentError } from './document-session';
/** Real Loro native owner on the common protected document lifecycle. */
export function makeLabLoroSession(
  input: Omit<Parameters<typeof makeStreamsUpdateBinding>[0], 'model'> & {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly streamUrl: string;
    readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
    readonly snapshotUpload?: boolean;
  }
) {
  return makeLabDocumentSession({ ...input, model: 'loro' }, () => {
    const doc = new LoroDoc();
    return {
      adapter: () => createLoroDocAdapter(doc),
      exportSnapshot: () => doc.export({ mode: 'snapshot' }),
      importSnapshot: (bytes) => {
        doc.import(bytes);
      },
      append: (text) => {
        const value = doc.getText('text');
        value.insert(value.length, text);
        doc.commit();
      },
      text: () => doc.getText('text').toString(),
      release: () => doc.free(),
    };
  });
}
