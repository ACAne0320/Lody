import type { Effect, Scope } from 'effect';
import type { NativeTransport, RepoError, RoomTarget } from 'loro-repo/effect';

export type WorkspaceNativeTransport = NativeTransport & {
  readonly createStream?: (target: RoomTarget) => Effect.Effect<boolean, RepoError>;
};

/** A transport is acquired only when its owning workspace attaches it. */
export type NativeWorkspaceTransport<
  T extends WorkspaceNativeTransport = WorkspaceNativeTransport,
> = {
  readonly kind: 'native-workspace-transport';
  readonly make: (id: string) => Effect.Effect<T, RepoError, Scope.Scope>;
};
