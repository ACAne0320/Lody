/**
 * The step a Session start was in when it failed. `SessionManager.createSession`
 * reports each step as it begins; the turn keeps the last one so a failure names
 * where it happened without wrapping (and re-classifying) the original error.
 */
export type SessionStartStage =
  | 'credentials'
  | 'workdir'
  | 'worktree'
  | 'git-identity'
  | 'agent-runtime'
  | 'agent-start';

const STAGE_LABELS: Record<SessionStartStage, string> = {
  credentials: 'Preparing repository credentials',
  workdir: 'Preparing the working directory',
  worktree: 'Preparing the worktree',
  'git-identity': 'Resolving the Git identity',
  'agent-runtime': 'Resolving the agent runtime',
  'agent-start': 'Starting the agent',
};

/** User-visible failure text: the step first, then the error's own message. */
export const describeSessionStartFailure = (
  stage: SessionStartStage | undefined,
  message: string
): string => (stage ? `${STAGE_LABELS[stage]} failed: ${message}` : message);
