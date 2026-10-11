import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCloudAction } from '@lody/platform/react';
import { Button } from '@lody/ui/button';
import type { FunctionReturnType } from 'convex/server';
import { useAuthenticatedConvex } from '@/hooks/use-authenticated-convex';
import { cloudOperations } from '@/lib/cloud-api-operations';
import { Dialog } from '@/ui/dialog';

type Target = { workspaceId: string; sessionId: string; repoFullName: string; prNumber: number };
type Candidate = FunctionReturnType<
  typeof import('@lody/cloud-api').api.github.previewMissingPrAssociation
>;

/** A preview and consent belong to one app login and one owner-session PR. */
export function MissingPrAssociationAction(target: Target) {
  const { authSessionId, isAuthenticated } = useAuthenticatedConvex();
  if (!isAuthenticated || !authSessionId) return null;
  return (
    <AssociationConfirmation
      key={JSON.stringify([
        authSessionId,
        target.workspaceId,
        target.sessionId,
        target.repoFullName,
        target.prNumber,
      ])}
      {...target}
    />
  );
}

function AssociationConfirmation(target: Target) {
  const { t } = useTranslation();
  const preview = useCloudAction(cloudOperations.github.previewMissingPrAssociation);
  const confirm = useCloudAction(cloudOperations.github.confirmMissingPrAssociation);
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setOpen(true);
    setCandidate(null);
    setError(null);
    setPending(true);
    try {
      setCandidate(await preview(target));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  const associate = async () => {
    if (!candidate || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await confirm({
        ...target,
        expectedRepositoryId: candidate.repositoryId,
        expectedPrNodeId: candidate.prNodeId,
      });
      if (!result.associated)
        throw new Error(t('sessions.prTab.associationFailed', 'No association was created.'));
      setOpen(false);
    } catch (cause) {
      // A failed confirmation needs a new preview, never another blind write.
      setCandidate(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button size="mini" variant="ghost" onClick={() => void verify()} disabled={pending}>
        {t('sessions.prTab.verifyAssociation', 'Verify and associate PR')}
      </Button>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <Dialog.Content width="md">
          <Dialog.Header>
            <Dialog.Title>
              {t('sessions.prTab.associationTitle', 'Associate this session with the current PR?')}
            </Dialog.Title>
            <Dialog.Description>
              {t(
                'sessions.prTab.associationConfirmation',
                'The original association is missing and cannot be reconstructed. Confirm only if the current repository and PR shown below belong to this session. This creates a new association for GitHub details and future PR updates.'
              )}
            </Dialog.Description>
          </Dialog.Header>
          {candidate && (
            <div className="space-y-1 break-words text-sm">
              <p>
                {candidate.repoFullName} #{candidate.prNumber}
              </p>
              <p>{candidate.title}</p>
              <a
                className="text-primary underline"
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
              >
                {t('sessions.prTab.openOnGitHub', 'Open on GitHub')}
              </a>
            </div>
          )}
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          <Dialog.Footer>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t('common.cancel', 'Cancel')}
            </Button>
            {candidate ? (
              <Button onClick={() => void associate()} disabled={pending}>
                {t('sessions.prTab.confirmAssociation', 'Confirm association')}
              </Button>
            ) : (
              <Button onClick={() => void verify()} disabled={pending}>
                {pending
                  ? t('sessions.prTab.verifyingAssociation', 'Verifying…')
                  : t('sessions.prTab.retry', 'Retry')}
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
