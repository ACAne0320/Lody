import {
  getProjectRunRoot,
  resolveProjectMemberPaths,
  type MachineId,
  type ProjectMember,
  type ProjectMemberId,
  type ProjectRef,
  type SessionProjectMember,
  type SessionProjectRun,
  type WorkspaceProject,
} from '@lody/shared';
import { collectProjectSubmoduleDescendants } from '@/lib/project-group-form';

/**
 * Placeholder bases the client freezes into a new conversation's snapshot.
 *
 * The client cannot resolve a default branch or a gitlink commit; the daemon
 * that owns the conversation — the only writer of `projectRun` after creation
 * — replaces these when it materializes the members.
 */
export const PROJECT_RUN_DEFAULT_BASE = 'HEAD';
export const PROJECT_RUN_GITLINK_BASE = 'gitlink';

/**
 * The members a new conversation will use: everything not unticked, minus the
 * submodules of an unticked parent — a submodule is checked out by its
 * parent's worktree, so it cannot exist without it.
 */
export function selectProjectGroupMembers(
  project: Pick<WorkspaceProject, 'members'>,
  excluded: ReadonlySet<ProjectMemberId>
): ProjectMember[] {
  const dropped = new Set<ProjectMemberId>(excluded);
  for (const id of excluded) {
    for (const child of collectProjectSubmoduleDescendants(project.members, id)) dropped.add(child);
  }
  return project.members.filter((member) => !dropped.has(member.id));
}

export type ProjectGroupLaunchTarget =
  | { kind: 'ready'; members: ProjectMember[]; machineId: MachineId | null }
  | { kind: 'empty' }
  | { kind: 'machines_conflict'; machineIds: MachineId[] };

/**
 * Where a conversation in this group can run. Local members pin the machine
 * that holds them; GitHub members run anywhere. Local members on two machines
 * cannot share one conversation, because a conversation runs on one machine.
 */
export function resolveProjectGroupLaunchTarget(
  project: Pick<WorkspaceProject, 'members'>,
  excluded: ReadonlySet<ProjectMemberId>
): ProjectGroupLaunchTarget {
  const members = selectProjectGroupMembers(project, excluded);
  if (members.length === 0) return { kind: 'empty' };
  const machineIds = [
    ...new Set(
      members.flatMap((member) => (member.source.kind === 'local' ? [member.source.machineId] : []))
    ),
  ];
  if (machineIds.length > 1) return { kind: 'machines_conflict', machineIds };
  return { kind: 'ready', members, machineId: machineIds[0] ?? null };
}

/**
 * Freeze the snapshot a multi-member conversation is created with.
 * Returns `undefined` for fewer than two members: one repository is an
 * ordinary single-project conversation (see `buildProjectGroupProjectRef`).
 */
export function buildSessionProjectRun(
  project: WorkspaceProject,
  members: readonly ProjectMember[]
): SessionProjectRun | undefined {
  if (members.length < 2) return undefined;
  const ids = new Set(members.map((member) => member.id));
  // A submodule whose parent is not running would have nowhere to live.
  const kept = members.filter(
    (member) => member.placement.kind !== 'submodule' || ids.has(member.placement.parent)
  );
  if (kept.length < 2) return undefined;
  const paths = resolveProjectMemberPaths(kept);
  const record = Object.create(null) as Record<ProjectMemberId, SessionProjectMember>;
  kept.forEach((member, index) => {
    record[member.id] = {
      o: index,
      src: member.source,
      placement: member.placement,
      path: paths[member.id]!,
      base:
        member.placement.kind === 'submodule'
          ? PROJECT_RUN_GITLINK_BASE
          : (member.source.baseBranch ?? PROJECT_RUN_DEFAULT_BASE),
    };
  });
  return {
    id: project.id,
    name: project.name,
    ...(project.instructions ? { instructions: project.instructions } : {}),
    root: getProjectRunRoot(project),
    members: record,
  };
}

/**
 * The legacy `project` field: the first member, so older clients still show
 * a repository, a branch and a PR for the conversation.
 */
export function buildProjectGroupProjectRef(member: ProjectMember): ProjectRef {
  return member.source.kind === 'github'
    ? {
        kind: 'github',
        repoFullName: member.source.repoFullName,
        branch: member.source.baseBranch ?? '',
      }
    : {
        kind: 'local',
        localProjectId: member.source.localProjectId,
        ...(member.source.baseBranch ? { branch: member.source.baseBranch } : {}),
        useWorktree: true,
      };
}
