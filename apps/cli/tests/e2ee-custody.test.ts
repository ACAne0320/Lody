import { Effect, Result } from 'effect';
import { mkdtempSync, rmSync, readFileSync, statSync, chmodSync, renameSync, symlinkSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { Bytes } from '@lody/e2ee-core/protocol';
import { makeCliE2eeCustody, type MachineKeyring } from '../src/lib/e2ee/custody';
const genesis = Result.getOrThrow(Bytes.genesisHash(new Uint8Array(32).fill(7)));

describe('machine E2EE custody', () => {
  it('selects file protection without a keyring and reopens the same machine identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'machine-custody-'));
    const keyring: MachineKeyring = async () => { throw new Error('synthetic unavailable'); };
    try {
      const before = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const custody = yield* makeCliE2eeCustody({ directory, keyring });
        expect(custody.protection).toBe('file');
        return (yield* custody.createDevice(genesis)).publicKey.toBytes();
      })));
      expect(statSync(join(directory, 'kek.safe-storage')).mode & 0o777).toBe(0o600);
      const after = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const custody = yield* makeCliE2eeCustody({ directory, keyring: async () => { throw new Error('must not switch'); } });
        expect(custody.protection).toBe('file');
        return (yield* custody.openDevice(genesis)).publicKey.toBytes();
      })));
      expect(after).toEqual(before);
      chmodSync(join(directory, 'kek.safe-storage'), 0o644);
      const result = await Effect.runPromise(Effect.scoped(Effect.result(makeCliE2eeCustody({ directory, keyring }))));
      expect(Result.isFailure(result)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('refuses a symlink KEK and never downgrades an existing OS-protected custody', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'machine-keyring-'));
    const secrets = new Map<string, string>();
    let locked = false;
    const keyring: MachineKeyring = async account => ({
      getPassword: async () => { if (locked) throw new Error('locked'); return secrets.get(account); },
      setPassword: async value => { if (locked) throw new Error('locked'); secrets.set(account, value); },
      deleteCredential: async () => { secrets.delete(account); },
    });
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const custody = yield* makeCliE2eeCustody({ directory, keyring });
        expect(custody.protection).toBe('os-keystore');
        yield* custody.createDevice(genesis);
      })));
      const original = readFileSync(join(directory, 'kek.safe-storage'));
      locked = true;
      expect(Result.isFailure(await Effect.runPromise(Effect.scoped(Effect.result(makeCliE2eeCustody({ directory, keyring })))))).toBe(true);
      expect(readFileSync(join(directory, 'protection'), 'utf8')).toBe('os-keystore');
      expect(readFileSync(join(directory, 'kek.safe-storage'))).toEqual(original);
      locked = false;
      renameSync(join(directory, 'kek.safe-storage'), join(directory, 'original'));
      symlinkSync(join(directory, 'original'), join(directory, 'kek.safe-storage'));
      expect(Result.isFailure(await Effect.runPromise(Effect.scoped(Effect.result(makeCliE2eeCustody({ directory, keyring })))))).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('preserves originals when a KEK or selected protection is missing', async () => {
    for (const missing of ['kek.safe-storage', 'protection']) {
      const directory = mkdtempSync(join(tmpdir(), 'machine-loss-'));
      const keyring: MachineKeyring = async () => { throw new Error('synthetic unavailable'); };
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const custody = yield* makeCliE2eeCustody({ directory, keyring });
          yield* custody.createDevice(genesis);
        })));
        const originals = new Map(readdirSync(directory).filter(name => name.endsWith('.device')).map(name => [name, readFileSync(join(directory, name))]));
        unlinkSync(join(directory, missing));
        const result = await Effect.runPromise(Effect.scoped(Effect.result(makeCliE2eeCustody({ directory, keyring }))));
        expect(Result.isFailure(result)).toBe(true);
        expect(existsSync(join(directory, missing))).toBe(false);
        for (const [name, bytes] of originals) expect(readFileSync(join(directory, name))).toEqual(bytes);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });

});
