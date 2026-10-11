import { Brand, Result } from 'effect';
import { ValidationError } from './errors';

/** Secret value with private registry provenance, no reflective material accessor. */
export interface EpochKey extends Brand.Brand<'EpochKey'> {}
const materials = new WeakMap<EpochKey, Uint8Array>();

export function epochKey(input: unknown): Result.Result<EpochKey, ValidationError> {
  if (!(input instanceof Uint8Array) || input.length !== 32)
    return Result.fail(new ValidationError({ code: 'canonical' }));
  const key = Object.freeze(Object.create(null)) as EpochKey;
  materials.set(key, new Uint8Array(input));
  return Result.succeed(key);
}

/** Package-internal crypto/persistence boundary; never re-export from an entrypoint. */
export function copyEpochKeyBytes(key: EpochKey): Uint8Array {
  const bytes = materials.get(key);
  if (!bytes) throw new TypeError('invalid-epoch-key');
  return new Uint8Array(bytes);
}
