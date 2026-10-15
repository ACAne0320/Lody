import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Effect, Exit, Fiber, Scope } from 'effect'
import { Bytes, verifySignature } from '@lody/e2ee-core'
import { signGenesisRecord } from '@lody/e2ee-core/ledger/admission'
import { makeDesktopE2eeCustody } from './e2ee-custody.mts'

// An authenticated synthetic native boundary, never a real OS keychain claim.
const wrapping = Buffer.alloc(32, 72)
function backend(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => {
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', wrapping, nonce)
      return Buffer.concat([nonce, cipher.update(value), cipher.final(), cipher.getAuthTag()])
    },
    decryptStringAsync: async (value) => {
      const cipher = createDecipheriv('aes-256-gcm', wrapping, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(-16))
      return {
        result: Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(),
        shouldReEncrypt: false
      }
    },
    ...overrides
  }
}
const hash = () => Bytes.genesisHash(new Uint8Array(32).fill(11)).success
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lody-e2ee-desktop-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
const execute = (work) => Effect.runPromise(Effect.scoped(work))
const installedBody = () => {
  const purpose = Buffer.from('lody-e2ee/local-epoch-key/v1\0')
  const body = Buffer.alloc(purpose.length + 32 * 4 + 4)
  purpose.copy(body)
  body.fill(17, purpose.length, purpose.length + 32)
  body.fill(18, purpose.length + 32, purpose.length + 64)
  body.writeUInt32BE(9, purpose.length + 64)
  body.fill(19, purpose.length + 68, purpose.length + 100)
  body.fill(97, body.length - 32)
  return body
}
const candidateBody = () => {
  const prefix = Buffer.from('lody-e2ee/local-epoch-candidate/v1\0')
  const header = prefix.length + 32 * 6 + 12,
    body = Buffer.alloc(header + 41 + 32)
  prefix.copy(body)
  body.fill(22, prefix.length, prefix.length + 32 * 6)
  body.writeUInt32BE(4, prefix.length + 32 * 6)
  body.writeUInt32BE(9, prefix.length + 32 * 6 + 4)
  body.writeUInt32BE(41, header - 4)
  body.fill(23, header, header + 41)
  body.fill(98, header + 41)
  return body
}
void test('rejects unavailable and basic_text before creating any storage', async (t) => {
  const directory = await fixture(t)
  for (const [changes, code] of [
    [{ isEncryptionAvailable: () => false }, 'unavailable'],
    [{ isAsyncEncryptionAvailable: async () => false }, 'unavailable'],
    [{ getSelectedStorageBackend: () => 'basic_text' }, 'basic-text'],
    [{ getSelectedStorageBackend: () => 'unknown' }, 'unavailable']
  ]) {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.result(
          makeDesktopE2eeCustody({ directory, platform: 'linux', safeStorage: backend(changes) })
        )
      )
    )
    assert.equal(result.failure?.code, code)
    assert.deepEqual(await readdir(directory), [])
  }
})
void test('macOS/Windows do not require the Linux-only backend method', async (t) => {
  for (const platform of ['darwin', 'win32']) {
    const directory = await fixture(t)
    const storage = backend()
    delete storage.getSelectedStorageBackend
    await execute(
      Effect.gen(function* () {
        const owner = yield* makeDesktopE2eeCustody({ directory, platform, safeStorage: storage })
        const sealed = yield* Effect.promise(() => owner.installed.protect(installedBody()))
        assert.deepEqual(
          Buffer.from(yield* Effect.promise(() => owner.installed.unprotect(sealed))),
          installedBody()
        )
      })
    )
  }
})
void test('installed and candidate data authenticate full context and reopen with the first wrapped KEK', async (t) => {
  const directory = await fixture(t)
  const body = installedBody(),
    candidate = candidateBody()
  let encrypted, candidateBlob, originalWrapped
  await execute(
    Effect.gen(function* () {
      const storage = backend()
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: storage
      })
      // Capture once: caller mutation does not replace already selected methods.
      storage.encryptStringAsync = async () => {
        throw new Error('replaced')
      }
      encrypted = yield* Effect.promise(() => owner.installed.protect(body))
      candidateBlob = yield* Effect.promise(() => owner.candidate.protect(candidate))
      assert.notDeepEqual(encrypted, body)
      assert.deepEqual(
        Buffer.from(yield* Effect.promise(() => owner.installed.unprotect(encrypted))),
        body
      )
      const bad = new Uint8Array(encrypted)
      bad[45] ^= 1
      const result = yield* Effect.result(
        Effect.tryPromise({ try: () => owner.installed.unprotect(bad), catch: (e) => e })
      )
      assert.equal(result.failure?.code, 'corrupt')
      const wrongPurpose = yield* Effect.result(
        Effect.tryPromise({ try: () => owner.candidate.unprotect(encrypted), catch: (e) => e })
      )
      assert.equal(wrongPurpose.failure?.code, 'invalid-input')
      originalWrapped = yield* Effect.promise(() => readFile(join(directory, 'kek.safe-storage')))
    })
  )
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: backend()
      })
      assert.deepEqual(
        Buffer.from(yield* Effect.promise(() => owner.installed.unprotect(encrypted))),
        body
      )
      assert.deepEqual(
        Buffer.from(yield* Effect.promise(() => owner.candidate.unprotect(candidateBlob))),
        candidate
      )
    })
  )
  assert.deepEqual(await readFile(join(directory, 'kek.safe-storage')), originalWrapped)
  assert.equal((await stat(join(directory, 'kek.safe-storage'))).mode & 0o777, 0o600)
  for (const file of await readdir(directory)) {
    const stored = await readFile(join(directory, file))
    assert.equal(stored.includes(body.subarray(-32)), false)
    assert.equal(stored.includes(candidate.subarray(-32)), false)
  }
})
void test('opaque personal/machine identity persists; native keys are nonextractable; recovery cannot persist', async (t) => {
  const directory = await fixture(t)
  const challenge = new Uint8Array([1, 3, 5, 7])
  let original, encryption
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: backend()
      })
      const device = yield* owner.createDevice(hash())
      original = device.publicKey.toBytes()
      encryption = device.enc.toBytes()
      const signature = yield* device.sign(challenge)
      assert.equal(verifySignature(original, challenge, signature.toBytes())._tag, 'Success')
      assert.equal(device.encryption.privateKey.extractable, false)
      const same = yield* owner.createDevice(hash())
      assert.deepEqual(same.publicKey.toBytes(), original)
      const machine = yield* owner.createDevice(hash(), 'machine')
      assert.notDeepEqual(machine.publicKey.toBytes(), original)
      const denied = yield* Effect.result(owner.createDevice(hash(), 'recovery'))
      assert.equal(denied.failure?.code, 'invalid-input')
    })
  )
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: backend()
      })
      const device = yield* owner.openDevice(hash())
      assert.deepEqual(device.publicKey.toBytes(), original)
      assert.deepEqual(device.enc.toBytes(), encryption)
      assert.equal(
        verifySignature(original, challenge, (yield* device.sign(challenge)).toBytes())._tag,
        'Success'
      )
    })
  )
  for (const file of await readdir(directory)) {
    const value = await readFile(join(directory, file))
    assert.equal(
      value.includes(
        Buffer.from([0x30, 0x2e, 0x02, 0x01, 0, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70])
      ),
      false
    )
  }
})
void test('corrupted wrapper fails closed without replacing it; corrupted device AAD is refused', async (t) => {
  const directory = await fixture(t)
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: backend()
      })
      yield* owner.createDevice(hash())
    })
  )
  const device = (await readdir(directory)).find((value) => value.endsWith('.device'))
  const raw = await readFile(join(directory, device))
  raw[48] ^= 1
  await writeFile(join(directory, device), raw)
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: backend()
      })
      const denied = yield* Effect.result(owner.openDevice(hash()))
      assert.equal(denied.failure?.code, 'corrupt')
    })
  )
  const wrapped = await readFile(join(directory, 'kek.safe-storage'))
  wrapped[wrapped.length - 1] ^= 1
  await writeFile(join(directory, 'kek.safe-storage'), wrapped)
  const denied = await Effect.runPromise(
    Effect.scoped(
      Effect.result(
        makeDesktopE2eeCustody({ directory, platform: 'linux', safeStorage: backend() })
      )
    )
  )
  assert.equal(denied._tag, 'Failure')
  assert.deepEqual(await readFile(join(directory, 'kek.safe-storage')), wrapped)
})
void test('Scope waits actual native identity generation before clearing the KEK and refuses late work', async (t) => {
  const directory = await fixture(t)
  const subtle = crypto.subtle
  const original = subtle.generateKey.bind(subtle)
  let started, release
  const began = new Promise((resolve) => {
    started = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  subtle.generateKey = async (...args) => {
    const value = await original(...args)
    started()
    await gate
    return value
  }
  t.after(() => {
    subtle.generateKey = original
    release()
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      try {
        const scope = yield* Scope.make()
        const owner = yield* makeDesktopE2eeCustody({
          directory,
          platform: 'linux',
          safeStorage: backend()
        }).pipe(Effect.provideService(Scope.Scope, scope))
        const creation = yield* owner.createDevice(hash()).pipe(Effect.forkChild)
        yield* Effect.promise(() => began)
        yield* owner.stop()
        const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
        const closed = yield* Effect.result(owner.createDevice(hash()))
        assert.equal(closed.failure?.code, 'closed')
        assert.equal(
          closing.pollUnsafe(),
          undefined,
          'custody must not release while native key generation is unsettled'
        )
        release()
        const completed = yield* Fiber.await(creation)
        assert.equal(
          Exit.isSuccess(completed),
          true,
          'active native operation must complete before KEK release'
        )
        yield* Fiber.join(closing)
        const late = yield* Effect.result(owner.openDevice(hash()))
        assert.equal(late.failure?.code, 'closed')
      } finally {
        release()
      }
    })
  )
})
void test('another OS process reopens encrypted identity and epoch data without plaintext secret files', async (t) => {
  const directory = await fixture(t)
  let publicKey, kekHex, genesisHex
  const exported = []
  const subtle = crypto.subtle,
    originalExport = subtle.exportKey.bind(subtle)
  subtle.exportKey = async (...args) => {
    const value = await originalExport(...args)
    if (args[0] === 'pkcs8') exported.push(Buffer.from(value))
    return value
  }
  t.after(() => {
    subtle.exportKey = originalExport
    for (const value of exported) value.fill(0)
  })
  const storage = backend()
  const originalWrap = storage.encryptStringAsync
  storage.encryptStringAsync = async (value) => {
    kekHex = value
    return originalWrap(value)
  }
  const body = installedBody()
  await execute(
    Effect.gen(function* () {
      const owner = yield* makeDesktopE2eeCustody({
        directory,
        platform: 'linux',
        safeStorage: storage
      })
      const unused = yield* owner.prepareDevice()
      yield* owner.discardDevice(unused)
      assert.equal((yield* Effect.result(unused.sign(new Uint8Array([1]))))._tag, 'Failure')
      assert.deepEqual(
        (yield* Effect.promise(() => readdir(directory))).filter((name) =>
          name.endsWith('.device')
        ),
        []
      )
      const prepared = yield* owner.prepareDevice()
      const created = yield* signGenesisRecord({
        signer: prepared,
        encryptionPublicKey: prepared.enc,
        userId: Bytes.userId(new Uint8Array(32).fill(31)).success,
        membershipId: Bytes.membershipId(new Uint8Array(16).fill(32)).success,
        initialKey: Bytes.epochKey(new Uint8Array(32).fill(33)).success
      })
      genesisHex = Buffer.from(created.genesis.toBytes()).toString('hex')
      const retained = yield* owner.retainDevice(created.genesis, prepared)
      publicKey = retained.publicKey.toBytes()
      assert.deepEqual(
        (yield* owner.retainDevice(created.genesis, prepared)).publicKey.toBytes(),
        publicKey
      )
      assert.equal((yield* Effect.result(prepared.sign(new Uint8Array([1]))))._tag, 'Failure')
      const prefix = Buffer.from('lody-e2ee/local-epoch-key/v1\0')
      body.set(created.genesis.toBytes(), prefix.length)
      body.set(publicKey, prefix.length + 32)
      const encrypted = yield* Effect.promise(() => owner.installed.protect(body))
      yield* Effect.promise(() =>
        writeFile(join(directory, 'epoch.blob'), encrypted, { mode: 0o600 })
      )
    })
  )
  const { runCommandOk, ProcessSpawnerLive, NodeProcessLive } =
    await import('@lody/shared/node/process')
  const entry = new URL('./e2ee-custody.mts', import.meta.url).href
  const child = `
    import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
    import { readFile } from 'node:fs/promises';
    import { Effect } from 'effect';
    import { Bytes } from '@lody/e2ee-core';
    import { makeDesktopE2eeCustody } from ${JSON.stringify(entry)};
    const native = {
      isEncryptionAvailable: () => true, isAsyncEncryptionAvailable: async () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async () => { throw Error('must not create a second KEK'); },
      decryptStringAsync: async value => {
        const c = createDecipheriv('aes-256-gcm', Buffer.alloc(32,72), value.subarray(0,12));
        c.setAuthTag(value.subarray(-16));
        return {result: Buffer.concat([c.update(value.subarray(12,-16)),c.final()]).toString(),shouldReEncrypt:false};
      }
    };
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
      const owner = yield* makeDesktopE2eeCustody({ directory: process.argv[1], platform:'linux', safeStorage:native });
      const device = yield* owner.openDevice(Bytes.genesisHash(new Uint8Array(Buffer.from(process.argv[2],'hex'))).success);
      const blob = yield* Effect.promise(() => readFile(process.argv[1]+'/epoch.blob'));
      const opened = yield* Effect.promise(() => owner.installed.unprotect(blob));
      try {return {pid:process.pid,key:Buffer.from(device.publicKey.toBytes()).toString('hex'),signature:Buffer.from((yield*device.sign(new Uint8Array([1,2,3]))).toBytes()).toString('hex'),digest:createHash('sha256').update(opened).digest('hex')};}
      finally{opened.fill(0)}
    })));
    console.log(JSON.stringify(result));
  `
  const loader = import.meta.resolve('tsx')
  const result = await Effect.runPromise(
    runCommandOk({
      command: process.execPath,
      args: ['--import', loader, '--input-type=module', '-e', child, directory, genesisHex],
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env },
      maxOutputBytes: 65536
    }).pipe(Effect.provide(ProcessSpawnerLive), Effect.provide(NodeProcessLive))
  )
  const response = JSON.parse(result.stdout.toString().trim())
  assert.notEqual(response.pid, process.pid)
  assert.equal(response.key, Buffer.from(publicKey).toString('hex'))
  assert.equal(
    verifySignature(publicKey, new Uint8Array([1, 2, 3]), Buffer.from(response.signature, 'hex'))
      ._tag,
    'Success'
  )
  const { createHash } = await import('node:crypto')
  assert.equal(response.digest, createHash('sha256').update(body).digest('hex'))
  assert.ok(exported.length >= 2)
  for (const name of await readdir(directory)) {
    const value = await readFile(join(directory, name))
    assert.equal(value.includes(Buffer.from(kekHex)), false)
    assert.equal(value.includes(Buffer.from(kekHex, 'hex')), false)
    assert.equal(value.includes(body.subarray(-32)), false)
    for (const privateKey of exported) assert.equal(value.includes(privateKey), false)
  }
})
