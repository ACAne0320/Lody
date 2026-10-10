import type { ClientOptions, RoostNativeClient } from '@loro-dev/roost-node';

/** Keep the SDK's import.meta.url in its installed package, even in composing bundles. */
export async function createRoostNativeClient(options: ClientOptions): Promise<RoostNativeClient> {
  const runtime: typeof import('@loro-dev/roost-node') = await import(
    /* @vite-ignore */ import.meta.resolve('@loro-dev/roost-node')
  );
  return new runtime.RoostNativeClient(options);
}
