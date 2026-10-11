import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import { Bytes, verifySignature } from '@lody/e2ee-core';
import { contentPermissions, type LedgerView } from '@lody/e2ee-core/ledger';
import { makeLabOperations } from './operation-scope';

const MAX_LEASE_MS = 15 * 60 * 1000,
  CHALLENGE_TTL_MS = 60_000,
  APP = 0x4c454843;
export class LabCredentialError extends Data.TaggedError('LabCredentialError')<{
  readonly code: 'invalid-input' | 'unauthorized' | 'closed' | 'storage' | 'corrupt';
}> {}
const fail = (code: LabCredentialError['code']) => new LabCredentialError({ code });
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const accountValid = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0');
const hashValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
/** Preserve the frozen Lab v2 possession message, not a JWT or production identity claim. */
export function labPossessionMessage(
  account: string,
  device: Bytes.SigningPublicKey,
  nonce: string
) {
  return Result.try({
    try: () => {
      if (!accountValid(account) || !hashValid(nonce)) throw fail('invalid-input');
      const publicKey = Result.getOrThrow(Bytes.signingPublicKey(device.toBytes()));
      return new TextEncoder().encode(
        `e2ee-demo-device/v2\0${account}\0${hex(publicKey.toBytes())}\0${nonce}`
      );
    },
    catch: () => fail('invalid-input'),
  });
}
export interface LabCredential {
  readonly token: string;
  readonly account: string;
  readonly device: Bytes.SigningPublicKey;
  readonly genesis: Bytes.GenesisHash | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
}
/** Synthetic Lab device-possession credentials only. Account is a test label, not
 * verified product identity. The original Lab token TTL is retained; there are no
 * JWT claims, changes to ordinary JWT leeway, or strict production deadline B.
 * Authentication never replaces current genuine-ledger authorization at each route.
 * No private key/epoch key/vault storage. Scope owns one real SQLite metadata file. */
export function makeLabCredentials(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly now: () => number;
  readonly ledger: (genesis: Bytes.GenesisHash) => Effect.Effect<LedgerView, unknown>;
}) {
  return Effect.gen(function* () {
    const { path, mode, now, ledger } = input;
    const sql = <A>(work: () => A) =>
      Effect.try({
        try: work,
        catch: (error) => (error instanceof LabCredentialError ? error : fail('storage')),
      });
    if (typeof path !== 'string' || !isAbsolute(path) || (mode !== 'create' && mode !== 'open'))
      return yield* fail('invalid-input');
    if (mode === 'create') yield* sql(() => closeSync(openSync(path, 'wx', 0o600)));
    const db = yield* Effect.acquireRelease(
      sql(() => new Database(path, { fileMustExist: true, timeout: 1000 })),
      (value) => sql(() => value.close()).pipe(Effect.orDie)
    );
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const operations = yield* makeLabOperations();
    const guard = () => {
      if (closed || operations.signal.aborted) throw fail('closed');
    };
    const time = () => {
      const value = now();
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > Number.MAX_SAFE_INTEGER - MAX_LEASE_MS
      )
        throw fail('invalid-input');
      return value;
    };
    yield* sql(() => {
      if (mode === 'open') {
        if (
          db.pragma('application_id', { simple: true }) !== APP ||
          db.pragma('user_version', { simple: true }) !== 1
        )
          throw fail('corrupt');
      } else {
        db.exec(`PRAGMA application_id=${APP}; PRAGMA user_version=1;
          CREATE TABLE credential_challenges(nonce TEXT PRIMARY KEY,account TEXT NOT NULL,device_hex TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
          CREATE TABLE credentials(token TEXT PRIMARY KEY,account TEXT NOT NULL,device_hex TEXT NOT NULL,genesis_hex TEXT,issued_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,invalidated INTEGER NOT NULL DEFAULT 0) STRICT;`);
      }
      db.pragma('journal_mode=WAL');
      db.pragma('synchronous=FULL');
    });
    const parse = (row: unknown): LabCredential => {
      const value = row as {
        token: string;
        account: string;
        device_hex: string;
        genesis_hex: string | null;
        issued_at: number;
        expires_at: number;
        invalidated: number;
      };
      if (
        !value ||
        !hashValid(value.token) ||
        !accountValid(value.account) ||
        !hashValid(value.device_hex) ||
        (value.genesis_hex !== null && !hashValid(value.genesis_hex)) ||
        !Number.isSafeInteger(value.issued_at) ||
        value.issued_at < 0 ||
        !Number.isSafeInteger(value.expires_at) ||
        value.expires_at <= value.issued_at ||
        value.expires_at - value.issued_at > MAX_LEASE_MS ||
        ![0, 1].includes(value.invalidated)
      )
        throw fail('corrupt');
      const device = Result.getOrThrow(
        Bytes.signingPublicKey(new Uint8Array(Buffer.from(value.device_hex, 'hex')))
      );
      const genesis =
        value.genesis_hex === null
          ? null
          : Result.getOrThrow(
              Bytes.genesisHash(new Uint8Array(Buffer.from(value.genesis_hex, 'hex')))
            );
      return {
        token: value.token,
        account: value.account,
        device,
        genesis,
        issuedAt: value.issued_at,
        expiresAt: value.expires_at,
      };
    };
    const member = (device: Bytes.SigningPublicKey, genesis: Bytes.GenesisHash) =>
      Effect.gen(function* () {
        const view = yield* ledger(genesis);
        // Genuine public query first, never request-supplied structural state.
        yield* Effect.fromResult(contentPermissions(view, device));
        const state = view.inspectState(),
          active = state.devices.get(hex(device.toBytes()));
        if (
          !view.genesis.equals(genesis) ||
          !active ||
          !state.members.has(hex(active.membershipId.toBytes()))
        )
          yield* fail('unauthorized');
      });
    return Object.freeze({
      issueChallenge: (account: string, device: Bytes.SigningPublicKey) =>
        sql(() => {
          guard();
          const nonce = hex(randomBytes(32)),
            timestamp = time();
          Result.getOrThrow(labPossessionMessage(account, device, nonce));
          const deviceHex = hex(device.toBytes());
          db.transaction(() => {
            db.prepare(
              'INSERT INTO credential_challenges(nonce,account,device_hex,expires_at) VALUES(?,?,?,?)'
            ).run(nonce, account, deviceHex, timestamp + CHALLENGE_TTL_MS);
            const row = db
              .prepare(
                'SELECT account,device_hex,expires_at FROM credential_challenges WHERE nonce=?'
              )
              .get(nonce) as
              | { account: string; device_hex: string; expires_at: number }
              | undefined;
            if (
              !row ||
              row.account !== account ||
              row.device_hex !== deviceHex ||
              row.expires_at !== timestamp + CHALLENGE_TTL_MS
            )
              throw fail('storage');
          }).immediate();
          return nonce;
        }),
      completeChallenge: (request: {
        readonly account: string;
        readonly device: Bytes.SigningPublicKey;
        readonly nonce: string;
        readonly signature: Bytes.Signature;
        readonly genesis: Bytes.GenesisHash | null;
        readonly ttlMs?: number;
      }) =>
        operations.run(
          Effect.gen(function* () {
            const captured = yield* sql(() => {
              guard();
              const { account, nonce, ttlMs = MAX_LEASE_MS } = request;
              const device = Result.getOrThrow(Bytes.signingPublicKey(request.device.toBytes()));
              const signature = Result.getOrThrow(Bytes.signature(request.signature.toBytes()));
              const borrowedAnchor = request.genesis;
              const genesis =
                borrowedAnchor === null
                  ? null
                  : Result.getOrThrow(Bytes.genesisHash(borrowedAnchor.toBytes()));
              const message = Result.getOrThrow(labPossessionMessage(account, device, nonce));
              if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_LEASE_MS)
                throw fail('invalid-input');
              const timestamp = time();
              const row = db
                .transaction(() => {
                  const deleted = db
                    .prepare(
                      'DELETE FROM credential_challenges WHERE nonce=? RETURNING account,device_hex,expires_at'
                    )
                    .get(nonce) as
                    | { account: string; device_hex: string; expires_at: number }
                    | undefined;
                  if (db.prepare('SELECT 1 FROM credential_challenges WHERE nonce=?').get(nonce))
                    throw fail('storage');
                  return deleted;
                })
                .immediate();
              // One attempt consumes the challenge, including a mismatching signer/account.
              if (
                !row ||
                row.account !== account ||
                row.device_hex !== hex(device.toBytes()) ||
                !Number.isSafeInteger(row.expires_at) ||
                timestamp >= row.expires_at
              )
                throw fail('unauthorized');
              if (Result.isFailure(verifySignature(device.toBytes(), message, signature.toBytes())))
                throw fail('unauthorized');
              return { account, device, genesis, timestamp, ttlMs };
            });
            if (captured.genesis !== null) yield* member(captured.device, captured.genesis);
            return yield* sql(() => {
              guard();
              const token = hex(randomBytes(32)),
                expiresAt = captured.timestamp + captured.ttlMs;
              db.transaction(() => {
                db.prepare(
                  'INSERT INTO credentials(token,account,device_hex,genesis_hex,issued_at,expires_at,invalidated) VALUES(?,?,?,?,?,?,0)'
                ).run(
                  token,
                  captured.account,
                  hex(captured.device.toBytes()),
                  captured.genesis === null ? null : hex(captured.genesis.toBytes()),
                  captured.timestamp,
                  expiresAt
                );
                const row = db.prepare('SELECT * FROM credentials WHERE token=?').get(token);
                if (!row) throw fail('storage');
                const actual = parse(row);
                if (
                  (row as { invalidated: number }).invalidated !== 0 ||
                  actual.account !== captured.account ||
                  !actual.device.equals(captured.device) ||
                  actual.genesis?.equals(captured.genesis!) !==
                    (captured.genesis !== null ? true : undefined) ||
                  actual.issuedAt !== captured.timestamp ||
                  actual.expiresAt !== expiresAt
                )
                  throw fail('storage');
              }).immediate();
              return Object.freeze({
                token,
                account: captured.account,
                device: captured.device,
                genesis: captured.genesis,
                issuedAt: captured.timestamp,
                expiresAt,
              });
            });
          })
        ),
      authenticate: (token: string) =>
        sql(() => {
          guard();
          if (!hashValid(token)) throw fail('unauthorized');
          const row = db.prepare('SELECT * FROM credentials WHERE token=?').get(token);
          if (!row) throw fail('unauthorized');
          const value = parse(row);
          if ((row as { invalidated: number }).invalidated !== 0 || time() >= value.expiresAt)
            throw fail('unauthorized');
          return Object.freeze(value);
        }),
      invalidate: (token: string) =>
        sql(() => {
          guard();
          if (!hashValid(token)) throw fail('invalid-input');
          db.transaction(() => {
            db.prepare('UPDATE credentials SET invalidated=1 WHERE token=?').run(token);
            const row = db
              .prepare('SELECT invalidated FROM credentials WHERE token=?')
              .get(token) as { invalidated: number } | undefined;
            if (row && row.invalidated !== 1) throw fail('storage');
          }).immediate();
        }),
    });
  });
}
