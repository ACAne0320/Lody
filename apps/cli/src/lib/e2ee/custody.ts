import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, link, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { Effect } from 'effect';
import { runCommandOk } from '@lody/shared/node/process';
import { platformLayer } from '../../platform/process-options';
import {
  makeNodeE2eeCustody,
  NodeE2eeCustodyError,
  type KekWrapper,
} from '@lody/e2ee-core/adapters/node-custody';

/** Native boundary used by the machine-only custody; missing and failed reads stay distinct. */
export interface MachineKeyringEntry {
  getPassword(): Promise<string | undefined>;
  setPassword(value: string): Promise<void>;
  deleteCredential(): Promise<unknown>;
}
/** The entry factory is lazy: ordinary daemon startup never accesses a keyring. */
export type MachineKeyring = (account: string) => Promise<MachineKeyringEntry>;
const systemKeyring: MachineKeyring = async (account) => {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry('Lody E2EE Machine Custody', account, {
    linux: { store: 'secret-service' },
  });
};
const failure = (code: NodeE2eeCustodyError['code']) => new NodeE2eeCustodyError({ code });
const native = <A>(work: () => Promise<A>) =>
  Effect.uninterruptible(
    Effect.tryPromise({
      try: work,
      catch: (error) => (error instanceof NodeE2eeCustodyError ? error : failure('unavailable')),
    })
  );
// Windows mode bits do not restrict a DACL. Protect a newly created directory
// before publishing secrets; verify existing ACLs without silently repairing them.
function windowsAcl(path: string, create = false) {
  if (process.platform !== 'win32') return Effect.void;
  const encoded = Buffer.from(path, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
${
  create
    ? `
$a = New-Object Security.AccessControl.DirectorySecurity
$a.SetOwner($sid)
$a.SetAccessRuleProtection($true, $false)
$r = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$a.AddAccessRule($r)
Set-Acl -LiteralPath $p -AclObject $a`
    : ''
}
$a = Get-Acl -LiteralPath $p
if ($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
foreach ($r in $a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $sid.Value) { throw 'access' }
}
`;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) return Effect.fail(failure('unavailable'));
  return runCommandOk({
    command: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    maxOutputBytes: 1024,
    timeout: 15_000,
  }).pipe(
    Effect.provide(platformLayer({})),
    Effect.asVoid,
    Effect.mapError(() => failure('unavailable'))
  );
}
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function publish(path: string, value: string) {
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
    await file.close();
    await link(temporary, path);
  } finally {
    await file.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
async function privatePath(path: string, directory = false) {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
  )
    throw failure('corrupt');
}
async function readPrivate(path: string) {
  await privatePath(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      info.size < 1 ||
      info.size > 8192 ||
      (process.platform !== 'win32' &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw failure('corrupt');
    return await file.readFile();
  } finally {
    await file.close();
  }
}

/** Create/open one machine workspace's custody. First creation selects protection permanently;
 * later keyring errors never select file protection. The enclosing Scope owns all private buffers.
 */
export const makeCliE2eeCustody = Effect.fn('CliE2eeCustody.open')(function* (options: {
  readonly directory: string;
  readonly keyring?: MachineKeyring;
}) {
  const directory = options.directory;
  if (!isAbsolute(directory)) return yield* failure('invalid-input');
  const createdDirectory = yield* native(async () => {
    const created = !(await exists(directory));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await privatePath(directory, true);
    return created;
  });
  yield* windowsAcl(directory, createdDirectory);
  if (process.platform === 'win32') {
    const names = yield* native(() => readdir(directory));
    for (const name of names) yield* windowsAcl(join(directory, name));
  }
  const lockPath = join(directory, 'selection.sqlite');
  const mutex = yield* Effect.acquireRelease(
    native(async () => {
      try {
        const file = await open(lockPath, 'wx', 0o600);
        await file.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await privatePath(lockPath);
      const db = new DatabaseSync(lockPath);
      try {
        db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
        return db;
      } catch {
        db.close();
        throw failure('unavailable');
      }
    }),
    (db) => Effect.sync(() => db.close())
  );
  const marker = join(directory, 'protection');
  const keyring = options.keyring ?? systemKeyring;
  let protection: KekWrapper['protection'];
  let selected: Buffer | undefined;
  selected = yield* native(() =>
    readPrivate(marker).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    })
  );
  // Read absence without converting an existing keyring failure into creation.
  if (selected) protection = selected.toString('utf8') as KekWrapper['protection'];
  else protection = 'file';
  // The helper below preserves ENOENT while all other file failures refuse.
  if (!selected) {
    // A missing selector cannot authorize changing protection of existing originals.
    const originals = yield* native(async () =>
      (await readdir(directory)).some(
        (name) =>
          !/^selection\.sqlite(?:-journal|-wal|-shm)?$/.test(name) &&
          !/^protection\.[a-f0-9]{32}\.tmp$/.test(name)
      )
    );
    if (originals) return yield* failure('corrupt');
    const probeId = `probe:${randomBytes(16).toString('hex')}`;
    const probe = randomBytes(32).toString('hex');
    const available = yield* native(async () => {
      let entry: MachineKeyringEntry | undefined;
      try {
        entry = await keyring(probeId);
        await entry.setPassword(probe);
        return (await entry.getPassword()) === probe;
      } catch {
        return false;
      } finally {
        if (entry) await entry.deleteCredential().catch(() => undefined);
      }
    });
    protection = available ? 'os-keystore' : 'file';
    yield* native(() => publish(marker, protection));
  }
  if (protection !== 'file' && protection !== 'os-keystore') return yield* failure('corrupt');
  // Once a device exists, a lost KEK must preserve the remaining originals.
  const missingKek = yield* native(
    async () =>
      !(await exists(join(directory, 'kek.safe-storage'))) &&
      (await readdir(directory)).some((name) => name.endsWith('.device'))
  );
  if (missingKek) return yield* failure('corrupt');
  let key: Uint8Array | undefined;
  yield* Effect.addFinalizer(() => Effect.sync(() => key?.fill(0)));
  if (protection === 'os-keystore') {
    key = yield* native(async () => {
      const account = createHash('sha256').update(directory).digest('hex');
      const entry = await keyring(account);
      let encoded = await entry.getPassword();
      if (encoded === undefined) {
        // A missing wrapper for existing encrypted originals is a loss, not a new identity.
        try {
          await lstat(join(directory, 'kek.safe-storage'));
          throw failure('unavailable');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const original = randomBytes(32).toString('hex');
        await entry.setPassword(original);
        encoded = await entry.getPassword();
        if (encoded !== original) throw failure('unavailable');
      }
      if (!/^[0-9a-f]{64}$/.test(encoded)) throw failure('corrupt');
      return new Uint8Array(Buffer.from(encoded, 'hex'));
    });
  }
  const wrappingKey = key;
  if (protection === 'os-keystore' && !wrappingKey) return yield* failure('unavailable');
  const aad = new TextEncoder().encode('lody-e2ee/cli-kek-wrapper/v1\0');
  const wrapper: KekWrapper =
    protection === 'file'
      ? {
          protection,
          wrap: async (value) => Buffer.from(value, 'hex'),
          unwrap: async (blob) => {
            await privatePath(directory, true);
            await privatePath(join(directory, 'kek.safe-storage'));
            if (blob.length !== 32) throw failure('corrupt');
            return { result: Buffer.from(blob).toString('hex'), shouldReEncrypt: false };
          },
        }
      : {
          protection,
          wrap: async (value) => {
            const nonce = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', wrappingKey ?? new Uint8Array(), nonce);
            cipher.setAAD(aad);
            const plaintext = Buffer.from(value, 'hex');
            try {
              const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
              return new Uint8Array(Buffer.concat([nonce, cipher.getAuthTag(), body]));
            } finally {
              plaintext.fill(0);
            }
          },
          unwrap: async (blob) => {
            if (blob.length !== 60) throw failure('corrupt');
            const cipher = createDecipheriv(
              'aes-256-gcm',
              wrappingKey ?? new Uint8Array(),
              blob.subarray(0, 12)
            );
            cipher.setAAD(aad);
            cipher.setAuthTag(blob.subarray(12, 28));
            const plaintext = Buffer.concat([cipher.update(blob.subarray(28)), cipher.final()]);
            try {
              return { result: plaintext.toString('hex'), shouldReEncrypt: false };
            } finally {
              plaintext.fill(0);
            }
          },
        };
  const custody = yield* makeNodeE2eeCustody({ directory, wrapper });
  // Release the initialization lock after the underlying custody has opened, retaining its Scope.
  yield* Effect.sync(() => mutex.exec('ROLLBACK'));
  return Object.freeze({
    protection,
    prepareDevice: () => custody.prepareDevice('machine'),
    retainDevice: custody.retainDevice,
    discardDevice: custody.discardDevice,
    createDevice: (genesis: Parameters<typeof custody.createDevice>[0]) =>
      custody.createDevice(genesis, 'machine'),
    openDevice: (genesis: Parameters<typeof custody.openDevice>[0]) =>
      custody.openDevice(genesis, 'machine'),
    installed: custody.installed,
    candidate: custody.candidate,
    stop: custody.stop,
    close: custody.close,
  });
});
