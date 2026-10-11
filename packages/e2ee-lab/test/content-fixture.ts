import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { NativeEpochProtector } from '@lody/e2ee-core/keys/host';
/** Explicit synthetic wrapping boundary, not Keychain/native platform custody or a production algorithm choice. */
export const syntheticProtector: NativeEpochProtector = {
  async protect(body) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 91), nonce);
    return new Uint8Array(
      Buffer.concat([nonce, cipher.update(body), cipher.final(), cipher.getAuthTag()])
    );
  },
  async unprotect(blob) {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 91), blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(-16));
    return new Uint8Array(
      Buffer.concat([decipher.update(blob.subarray(12, -16)), decipher.final()])
    );
  },
};
