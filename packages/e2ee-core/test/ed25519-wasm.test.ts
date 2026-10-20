import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Point, etc, hashes, utils, verify } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import {
  setEd25519WasmEnabled,
  wasmSigningKeyValid,
  wasmVerifyStrict,
} from '../src/internal/foundation/ed25519-wasm';
import {
  ED25519_WASM_BASE64,
  ED25519_WASM_SHA256,
} from '../src/internal/foundation/ed25519-wasm.generated';
import { signingPublicKey } from '../src/internal/foundation/bytes';
import { verifySignature } from '../src/internal/foundation/signature';

hashes.sha512 = sha512;
const toNumber = (bytes: Uint8Array) => {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
};
const le = (n: bigint) => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++, n >>= 8n) bytes[i] = Number(n & 0xffn);
  return bytes;
};

// Independent reference with the pure-JS rules core enforces (bytes.ts, signature.ts).
const L = Point.CURVE().n;
const P = Point.CURVE().p;
const nobleKey = (key: Uint8Array) => {
  try {
    const point = Point.fromBytes(key, false);
    return !point.isSmallOrder() && point.isTorsionFree();
  } catch {
    return false;
  }
};
const nobleVerify = (key: Uint8Array, message: Uint8Array, signature: Uint8Array) => {
  if (!nobleKey(key)) return false;
  try {
    const s = toNumber(signature.subarray(32));
    const r = Point.fromBytes(signature.subarray(0, 32), false);
    if (s >= L || r.is0() || !r.isTorsionFree()) return false;
    return verify(signature, message, key, { zip215: false });
  } catch {
    return false;
  }
};
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const modL = (bytes: Uint8Array) => etc.mod(toNumber(bytes), L);

/** Small-order points: all eight torsion points. */
const torsion = (() => {
  const points = new Map<string, Point>();
  // T has order 8; its multiples are the whole torsion subgroup.
  const t8 = Point.fromBytes(
    etc.hexToBytes('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'),
    false
  );
  let point = Point.ZERO;
  for (let i = 0; i < 8; i++, point = point.add(t8)) points.set(point.toHex(), point);
  return [...points.values()];
})();

/** Signature with an arbitrary nonce point R (may be off the prime subgroup). */
function craft(secret: Uint8Array, message: Uint8Array, mutateR: (r: Point) => Point) {
  const { scalar, pointBytes } = utils.getExtendedPublicKey(secret);
  const nonce = modL(randomBytes(64));
  const r = mutateR(Point.BASE.multiply(nonce));
  const rBytes = r.toBytes();
  const k = modL(sha512(concat(rBytes, pointBytes, message)));
  const s = etc.mod(nonce + k * scalar, L);
  return { key: pointBytes, signature: concat(rBytes, le(s)) };
}

function nodeSigned(size: number) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const message = new Uint8Array(randomBytes(size));
  return { key, message, signature: new Uint8Array(sign(null, message, privateKey)) };
}

/** Non-canonical encodings: y + p (only for y < 19) and x = 0 with the sign bit set. */
const nonCanonical = (() => {
  const encodings: Uint8Array[] = [];
  for (let y = 0n; y < 19n; y++)
    for (const sign of [0, 0x80]) {
      const bytes = le(y + P);
      bytes[31]! |= sign;
      encodings.push(bytes);
    }
  for (const y of [1n, P - 1n]) {
    const bytes = le(y);
    bytes[31]! |= 0x80;
    encodings.push(bytes);
  }
  return encodings;
})();

describe('WebAssembly strict Ed25519', () => {
  it('embeds exactly the module its build recorded', () => {
    const bytes = Buffer.from(ED25519_WASM_BASE64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ED25519_WASM_SHA256);
    expect(wasmSigningKeyValid(new Uint8Array(32))).toBe(false);
  });

  it('needs no input to tell the canonical-encoding check apart from the subgroup rules', () => {
    // Non-canonical encodings exist only for y < 19 (y + p < 2^255) and x = 0.
    // None of those points is of prime order, so the subgroup rules already
    // reject every non-canonical A or R; the explicit check is defense in depth.
    for (let y = 0n; y < 19n; y++)
      for (const signBit of [0, 0x80]) {
        const bytes = le(y);
        bytes[31]! |= signBit;
        let point: Point | undefined;
        try {
          point = Point.fromBytes(bytes, false);
        } catch {
          continue;
        }
        expect(point.isSmallOrder() || !point.isTorsionFree()).toBe(true);
      }
  });

  it('agrees with the pure-JS key rules on valid, small-order, mixed-order, non-canonical and random keys', () => {
    const keys: Uint8Array[] = [
      ...Array.from({ length: 50 }, () => nodeSigned(0).key),
      ...torsion.map((point) => point.toBytes()),
      ...nonCanonical,
    ];
    const valid = Point.fromBytes(nodeSigned(0).key, false);
    for (const t of torsion.slice(1)) keys.push(valid.add(t).toBytes());
    for (let i = 0; i < 500; i++) keys.push(new Uint8Array(randomBytes(32)));
    for (const key of keys) expect([key, wasmSigningKeyValid(key)]).toEqual([key, nobleKey(key)]);
    expect(keys.filter((key) => wasmSigningKeyValid(key)).length).toBeGreaterThan(50);
  });

  it('agrees with the pure-JS verification on valid, tampered and adversarial signatures', () => {
    const cases: { key: Uint8Array; message: Uint8Array; signature: Uint8Array }[] = [];
    for (const size of [0, 1, 300, 8192, 20_000]) cases.push(nodeSigned(size));
    for (let i = 0; i < 40; i++) {
      const base = nodeSigned(64);
      cases.push(base);
      const flip = (bytes: Uint8Array, at: number) => {
        const copy = bytes.slice();
        copy[at % copy.length]! ^= 1 << (i % 8);
        return copy;
      };
      cases.push({ ...base, message: flip(base.message, i) });
      cases.push({ ...base, signature: flip(base.signature, i) });
      cases.push({ ...base, signature: flip(base.signature, 32 + i) });
      cases.push({ ...base, key: flip(base.key, i) });
      // S + L: same equation, non-canonical scalar.
      const s = toNumber(base.signature.subarray(32)) + L;
      cases.push({ ...base, signature: concat(base.signature.subarray(0, 32), le(s)) });
    }
    const secret = utils.randomSecretKey();
    const message = new Uint8Array(randomBytes(32));
    // Valid under the cofactored equation, but R has a torsion component.
    for (const t of torsion.slice(1)) {
      const mixed = { message, ...craft(secret, message, (r) => r.add(t)) };
      // Only the prime-subgroup rule rejects these; they exercise it, not the equation.
      expect(verify(mixed.signature, message, mixed.key, { zip215: false })).toBe(true);
      cases.push(mixed);
    }
    // Small-order R and A, and non-canonical R.
    for (const t of torsion) cases.push({ message, ...craft(secret, message, () => t) });
    for (const encoding of nonCanonical) {
      const base = nodeSigned(32);
      cases.push({ ...base, signature: concat(encoding, base.signature.subarray(32)) });
      cases.push({ ...base, key: encoding });
    }
    const honest = craft(secret, message, (r) => r);
    cases.push({ message, ...honest });
    for (const { key, message: m, signature } of cases) {
      const expected = nobleVerify(key, m, signature);
      expect(wasmVerifyStrict(key, m, signature)).toBe(expected);
      // The pre-checked entry may skip only the key's subgroup check.
      if (nobleKey(key)) expect(wasmVerifyStrict(key, m, signature, true)).toBe(expected);
    }
    expect(wasmVerifyStrict(honest.key, message, honest.signature)).toBe(true);
  });

  it('gives core the same results and error codes with and without WebAssembly', () => {
    const inputs = [nodeSigned(100), { ...nodeSigned(100), message: new Uint8Array(3) }];
    const secret = utils.randomSecretKey();
    const message = new Uint8Array(randomBytes(32));
    inputs.push({ message, ...craft(secret, message, (r) => r.add(torsion[1]!)) });
    const run = () =>
      inputs.map(({ key, message: m, signature }) => {
        const result = verifySignature(key, m, signature);
        return result._tag === 'Success' ? 'ok' : result.failure.code;
      });
    const withWasm = run();
    setEd25519WasmEnabled(false);
    try {
      expect(run()).toEqual(withWasm);
      const random = new Uint8Array(randomBytes(32));
      const pure = signingPublicKey(random);
      setEd25519WasmEnabled(true);
      expect(signingPublicKey(random)._tag).toBe(pure._tag);
    } finally {
      setEd25519WasmEnabled(true);
    }
    expect(withWasm).toEqual(['ok', 'bad-signature', 'bad-signature']);
  });
});
