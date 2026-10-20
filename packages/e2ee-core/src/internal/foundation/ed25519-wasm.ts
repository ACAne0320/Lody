import { ED25519_WASM_BASE64 } from './ed25519-wasm.generated';

/**
 * Strict Ed25519 compiled from Rust (wasm/ed25519-strict) with exactly the
 * pure-JS rules: canonical nonzero prime-subgroup A and R, S < L, cofactored
 * equation. About 15x faster than the noble path. Not injectable: when
 * WebAssembly is unavailable (or refuses a synchronous compile) every call
 * returns undefined and callers use the pure-JS path, with identical results.
 */
type Exports = {
  readonly memory: WebAssembly.Memory;
  input(length: number): number;
  key_ok(): number;
  verify(messageLength: number, keyChecked: number): number;
};

let loaded: Exports | null | undefined;
let enabled = true;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function instance(): Exports | null {
  if (!enabled) return null;
  if (loaded === undefined) {
    try {
      const module = new WebAssembly.Module(decode(ED25519_WASM_BASE64));
      loaded = new WebAssembly.Instance(module).exports as unknown as Exports;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

function call(exports: Exports, parts: readonly Uint8Array[], run: () => number): boolean {
  const length = parts.reduce((total, part) => total + part.length, 0);
  // Grows memory if needed, so take the view after this call.
  const pointer = exports.input(length);
  const target = new Uint8Array(exports.memory.buffer, pointer, length);
  let offset = 0;
  for (const part of parts) {
    target.set(part, offset);
    offset += part.length;
  }
  const accepted = run() === 1;
  target.fill(0);
  return accepted;
}

/** Valid signing key (canonical, not small order, prime-order subgroup), or undefined without WebAssembly. */
export function wasmSigningKeyValid(key: Uint8Array): boolean | undefined {
  const exports = instance();
  if (!exports || key.length !== 32) return undefined;
  return call(exports, [key], () => exports.key_ok());
}

/**
 * Strict verification result, or undefined without WebAssembly. Pass
 * `keyChecked` only for a key `signingPublicKey` already accepted: it skips the
 * repeated prime-subgroup check of A (still decoded canonically).
 */
export function wasmVerifyStrict(
  key: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  keyChecked = false
): boolean | undefined {
  const exports = instance();
  if (!exports || key.length !== 32 || signature.length !== 64) return undefined;
  return call(exports, [key, signature, message], () =>
    exports.verify(message.length, keyChecked ? 1 : 0)
  );
}

/** Tests and benchmarks only: compare against the pure-JS path. Not exported by any entry. */
export function setEd25519WasmEnabled(value: boolean): void {
  enabled = value;
}
