import { Context, Effect, Layer } from 'effect';
import { make, type MakeOptions, type Repo } from 'loro-repo/effect';

/** One replica owner per workspace. Business services borrow this instance. */
export class WorkspaceRepo extends Context.Service<WorkspaceRepo, Repo>()(
  '@lody/shared/WorkspaceRepo'
) {}

export const makeWorkspaceRepo = (options: MakeOptions = {}) => make(options);

export const workspaceRepoLayer = (options: MakeOptions = {}) =>
  Layer.effect(WorkspaceRepo, makeWorkspaceRepo(options));

/** An existing document and a new business identity are different operations. */
export const openWorkspaceDoc = (id: string) =>
  Effect.flatMap(WorkspaceRepo, (repo) => repo.openDoc(id));

export const createWorkspaceDoc = (id: string, metadata: Parameters<Repo['createDoc']>[1]) =>
  Effect.flatMap(WorkspaceRepo, (repo) => repo.createDoc(id, metadata));

export const acquireWorkspaceRoom = (target: Parameters<Repo['acquireRoom']>[0]) =>
  Effect.flatMap(WorkspaceRepo, (repo) => repo.acquireRoom(target));
