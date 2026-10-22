import { describe, expect, it } from 'vitest';
import type { E2eeWorkspaceRuntime } from '@lody/platform';
import { LoroDoc } from 'loro-crdt';
import { createDesktopE2eeContent } from '../src/providers/desktop-e2ee-content';

const context = {
  protocol: 'loro-streams-crdt-payload-protection',
  version: 2,
  kind: 'update_batch',
} as const;

describe('desktop E2EE content epoch safety', () => {
  it.each([
    { epoch: 1, rotationRequired: false },
    { epoch: 0, rotationRequired: true },
  ])('retains local edits and stops encrypted sends after %j', async (status) => {
    const doc = new LoroDoc();
    const received: Uint8Array[] = [];
    let updateRequired = false;
    const runtime = {
      seal: async (_workspaceId: string, request: { plaintext: Uint8Array }) => {
        const sealed = new Uint8Array([99, request.plaintext.length]);
        received.push(sealed);
        return { header: new Uint8Array([3]), sealed };
      },
    } as unknown as E2eeWorkspaceRuntime;
    const access = createDesktopE2eeContent({
      runtime,
      workspaceId: 'workspace',
      genesisHash: '11'.repeat(32),
      epoch: 0,
      authToken: () => null,
      onKeyUpdateRequired: () => {
        updateRequired = true;
      },
    });
    try {
      const room =
        access.content.mode === 'protected'
          ? access.content.resolve({ kind: 'doc', docId: 'session' })
          : undefined;
      if (!room || room.mode !== 'protected') throw new Error('expected protected room');
      const request = {
        context,
        plaintext: new Uint8Array([1, 2]),
        additionalData: () => new Uint8Array([3]),
      };
      await room.config.provider.seal(request);
      const accepted = received.slice();
      access.updateStatus(status);
      doc.getText('draft').insert(0, 'saved locally while keys update');
      doc.commit();
      await expect(
        room.config.provider.seal({ ...request, plaintext: doc.export({ mode: 'update' }) })
      ).rejects.toThrow('e2ee_key_update_required');
      // An older status response cannot reopen the stopped sender.
      access.updateStatus({ epoch: 0, rotationRequired: false });
      await expect(room.config.provider.seal(request)).rejects.toThrow('e2ee_key_update_required');
      expect(received).toEqual(accepted);
      expect(doc.getText('draft').toString()).toBe('saved locally while keys update');
      expect(updateRequired).toBe(true);
    } finally {
      doc.free();
    }
  });
});
