import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getServerNow, type ProjectId, type ProjectMemberId, type WorkspaceProject } from '@lody/shared';
import { userAtom } from '@/atoms';
import { useDialogExitSnapshot } from '@/hooks/use-dialog-exit-snapshot';
import { useProjectMemberSources } from '@/hooks/use-project-member-sources';
import {
  useProjectSubmoduleDetection,
  type ProjectSubmoduleProbe,
} from '@/hooks/use-project-submodule-detection';
import { useWorkspaceProjectActions } from '@/hooks/use-workspace-projects';
import {
  applyDetectedProjectSubmodules,
  buildProjectGroupFormValue,
  buildWorkspaceProjectFromForm,
  EMPTY_PROJECT_GROUP_FORM_VALUE,
  getProjectMemberSourceKey,
  validateProjectGroupForm,
  type ProjectGroupFormValue,
  type ProjectGroupMemberDraft,
} from '@/lib/project-group-form';
import { Dialog } from '@/ui/dialog';
import { ProjectGroupForm, type ProjectGroupMemberStatus } from './project-group-form';
import { useSettingsPane } from './settings-page-header';
import { SETTINGS_EDITOR_DIALOG_LAYOUT, SETTINGS_EDITOR_DIALOG_WIDTH } from './surface';

/** A `create` carries its id from the moment it opens, like the Role editor. */
export type ProjectGroupEditorState =
  | { mode: 'add'; projectId: ProjectId; value: ProjectGroupFormValue }
  | { mode: 'edit'; project: WorkspaceProject; value: ProjectGroupFormValue; readOnly: boolean };

export const openProjectGroupEditorForCreate = (): ProjectGroupEditorState => ({
  mode: 'add',
  projectId: crypto.randomUUID() as ProjectId,
  value: EMPTY_PROJECT_GROUP_FORM_VALUE,
});

export const openProjectGroupEditorForEdit = (
  project: WorkspaceProject,
  readOnly: boolean
): ProjectGroupEditorState => ({
  mode: 'edit',
  project,
  value: buildProjectGroupFormValue(project),
  readOnly,
});

/**
 * The one Project group editor: name, members, how they nest, and the
 * instructions the agent receives first.
 *
 * Submodule relationships are detected as members are added and applied
 * without moving a member the user placed by hand.
 */
export function ProjectGroupEditorDialog({
  editor: openEditor,
  onChange,
  onClose,
  onSaved,
  probeLocal,
}: {
  editor: ProjectGroupEditorState | null;
  onChange: (editor: ProjectGroupEditorState) => void;
  onClose: () => void;
  onSaved?: (project: WorkspaceProject, meta: { created: boolean }) => void;
  /** Reads a local member's `.gitmodules` on its machine, when that machine offers it. */
  probeLocal?: ProjectSubmoduleProbe;
}) {
  const { t } = useTranslation();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const settingsPane = useSettingsPane();
  const { upsert } = useWorkspaceProjectActions();
  const { options, byKey } = useProjectMemberSources();
  const { shown: editor, onOpenChangeComplete } = useDialogExitSnapshot(openEditor);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const readOnly = editor?.mode === 'edit' && editor.readOnly;
  const value = editor?.value ?? EMPTY_PROJECT_GROUP_FORM_VALUE;

  const labelOf = useCallback(
    (member: ProjectGroupMemberDraft) =>
      byKey.get(getProjectMemberSourceKey(member.source))?.label ??
      (member.source.kind === 'github'
        ? member.source.repoFullName
        : t('settings.projectGroups.source.missingLocal')),
    [byKey, t]
  );
  const detailOf = useCallback(
    (member: ProjectGroupMemberDraft) => byKey.get(getProjectMemberSourceKey(member.source))?.detail,
    [byKey]
  );
  const repositoryOf = useCallback(
    (member: ProjectGroupMemberDraft) =>
      member.source.kind === 'github' ? member.source.repoFullName : undefined,
    []
  );

  const detection = useProjectSubmoduleDetection(value.members, {
    enabled: openEditor !== null && !readOnly,
    probeLocal,
  });

  // Fold detection into the draft as answers arrive. The helper returns the
  // same value when nothing moves, so this settles after one pass.
  useEffect(() => {
    if (!openEditor || readOnly) return;
    const next = applyDetectedProjectSubmodules(
      openEditor.value,
      detection.detected,
      repositoryOf,
      labelOf
    );
    if (next !== openEditor.value) onChange({ ...openEditor, value: next });
  }, [detection.detected, labelOf, onChange, openEditor, readOnly, repositoryOf]);

  const validation = useMemo(() => validateProjectGroupForm(value), [value]);
  const statusOf = useCallback(
    (memberId: ProjectMemberId): ProjectGroupMemberStatus =>
      detection.pending.has(memberId)
        ? 'pending'
        : detection.unavailable.has(memberId)
          ? 'unavailable'
          : undefined,
    [detection.pending, detection.unavailable]
  );

  const close = () => {
    setError(undefined);
    onClose();
  };

  const save = async () => {
    if (!editor || readOnly || !validation.valid || !currentUserId) return;
    const project = buildWorkspaceProjectFromForm(editor.value, {
      id: editor.mode === 'add' ? editor.projectId : editor.project.id,
      existing: editor.mode === 'edit' ? editor.project : undefined,
      ownerUserId: currentUserId,
      now: getServerNow(),
    });
    if (!project) {
      setError(t('settings.projectGroups.errors.invalid'));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      // Durable locally is done; the upload is not something to wait on.
      await upsert(project);
      onSaved?.(project, { created: editor.mode === 'add' });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      open={openEditor !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <Dialog.Content
        width={SETTINGS_EDITOR_DIALOG_WIDTH}
        centerOn={settingsPane}
        className={SETTINGS_EDITOR_DIALOG_LAYOUT}
        style={{ height: 'min(680px, 88dvh)' }}
      >
        <Dialog.Header>
          <Dialog.Title>
            {editor?.mode === 'edit'
              ? readOnly
                ? editor.project.name
                : t('settings.projectGroups.editTitle')
              : t('settings.projectGroups.addTitle')}
          </Dialog.Title>
          <Dialog.Description>
            {readOnly
              ? t('settings.projectGroups.readOnlyDescription')
              : t('settings.projectGroups.dialogDescription')}
          </Dialog.Description>
        </Dialog.Header>
        {editor ? (
          <ProjectGroupForm
            value={value}
            onChange={(next) => {
              // A panel fading out is not edited: a change there would reopen it.
              if (openEditor) onChange({ ...openEditor, value: next });
            }}
            sources={options}
            labelOf={labelOf}
            detailOf={detailOf}
            statusOf={statusOf}
            validation={validation}
            readOnly={readOnly}
            submitting={submitting}
            error={error}
            isEditing={editor.mode === 'edit'}
            onSubmit={() => void save()}
            onCancel={close}
          />
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
