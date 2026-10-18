import { useMemo, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, Folder, GitBranch, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectMember, ProjectMemberId } from '@lody/shared';
import { selectProjectGroupMembers } from '@/lib/project-group-launch';
import { Menu } from '@lody/ui/menu';
import { colors } from '@lody/ui/tokens/colors.stylex';
import { space } from '@lody/ui/tokens/scales.stylex';
import { composerSurface } from '@/components/shared/composer-surface';
import { contextPill } from './context-pill-class';

const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space[1],
    height: '24px',
    minWidth: 0,
    paddingInline: space[2],
    borderRadius: '6px',
    borderWidth: 0,
    color: colors.label,
    fontSize: '0.9em',
    cursor: 'pointer',
    userSelect: 'none',
  },
  count: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  row: { display: 'flex', alignItems: 'center', gap: space[1.5], minWidth: 0 },
  // A submodule sits under its parent, one step further in per level, as it
  // will on disk.
  nested: (depth: number) => ({ paddingInlineStart: `${depth * 16}px` }),
  label: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  path: {
    flexShrink: 0,
    color: colors.tertiaryLabel,
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  },
  // What this machine lacks, after the path: one quiet phrase, never a badge.
  note: { flexShrink: 0, color: colors.tertiaryLabel, fontSize: '0.9em' },
});

const NO_MEMBERS: ReadonlySet<ProjectMemberId> = new Set();

export type ProjectGroupMemberPickerProps = {
  members: readonly ProjectMember[];
  excluded: ReadonlySet<ProjectMemberId>;
  onExcludedChange: (excluded: ReadonlySet<ProjectMemberId>) => void;
  labelOf: (member: ProjectMember) => string;
  /** Repository members the selected machine holds no copy of. */
  missing?: ReadonlySet<ProjectMemberId>;
  /**
   * Whether a missing member can be cloned instead. Without it (local-only)
   * a missing member stays unticked and cannot be ticked.
   */
  canClone?: boolean;
  disabled?: boolean;
};

/**
 * Which of a Project group's repositories this conversation uses.
 *
 * Every member starts ticked. A submodule follows its parent and is never
 * ticked on its own: the parent's worktree checks out every submodule it
 * declares anyway, so unticking one would save nothing and only lose its
 * branch and PR tracking. The count on the face says how many repositories
 * the conversation will get.
 */
export function ProjectGroupMemberPicker({
  members,
  excluded,
  onExcludedChange,
  labelOf,
  missing = NO_MEMBERS,
  canClone = true,
  disabled = false,
}: ProjectGroupMemberPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unavailable = canClone ? NO_MEMBERS : missing;
  const selected = useMemo(
    () =>
      new Set(
        selectProjectGroupMembers(
          { members: [...members] },
          unavailable.size > 0 ? new Set([...excluded, ...unavailable]) : excluded
        ).map((m) => m.id)
      ),
    [excluded, members, unavailable]
  );
  const ordered = useMemo(() => {
    const ids = new Set(members.map((member) => member.id));
    const roots = members.filter(
      (member) => member.placement.kind === 'root' || !ids.has(member.placement.parent)
    );
    const out: { member: ProjectMember; depth: number }[] = [];
    const visit = (member: ProjectMember, depth: number) => {
      out.push({ member, depth });
      for (const child of members) {
        if (child.placement.kind === 'submodule' && child.placement.parent === member.id) {
          visit(child, depth + 1);
        }
      }
    };
    for (const root of roots) visit(root, 0);
    return out;
  }, [members]);

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  // A submodule whose parent is in the group comes and goes with it.
  const followsParent = (member: ProjectMember) =>
    member.placement.kind === 'submodule' && memberIds.has(member.placement.parent);

  // Only top-level members are toggled; leaving out a parent leaves out its
  // submodules through the shared selection rule.
  const toggle = (member: ProjectMember, checked: boolean) => {
    const next = new Set(excluded);
    if (checked) next.delete(member.id);
    else next.add(member.id);
    onExcludedChange(next);
  };

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={t('chat.projectGroup.membersLabel', 'Repositories in this conversation')}
            {...stylex.props(
              styles.trigger,
              contextPill.surface,
              contextPill.interactive,
              open && contextPill.open
            )}
          />
        }
      >
        <span {...stylex.props(styles.count)}>
          {t('chat.projectGroup.membersCount', '{{selected}}/{{total}} repositories', {
            selected: selected.size,
            total: members.length,
          })}
        </span>
        <ChevronDown aria-hidden="true" {...stylex.props(composerSurface.chevron)} />
      </Menu.Trigger>
      <Menu.Content side="top" align="start">
        {ordered.map(({ member, depth }) => {
          const Icon =
            member.placement.kind === 'submodule'
              ? GitBranch
              : member.source.kind === 'github'
                ? Github
                : Folder;
          const path =
            member.placement.kind === 'root' ? `${member.placement.dir}/` : member.placement.path;
          const following = followsParent(member);
          const note = missing.has(member.id)
            ? canClone
              ? t('chat.projectGroup.memberClone', 'Cloned on start')
              : t('chat.projectGroup.memberMissing', 'Not on this machine')
            : following
              ? t('chat.projectGroup.memberWithParent', 'With its parent')
              : null;
          return (
            <Menu.CheckboxItem
              key={member.id}
              checked={selected.has(member.id)}
              disabled={following || unavailable.has(member.id)}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                if (!following) toggle(member, checked);
              }}
            >
              <span {...stylex.props(styles.row, styles.nested(depth))}>
                <Icon aria-hidden="true" {...stylex.props(composerSurface.glyph14)} />
                <span {...stylex.props(styles.label)}>{labelOf(member)}</span>
                <span {...stylex.props(styles.path)}>{path}</span>
                {note ? <span {...stylex.props(styles.note)}>{note}</span> : null}
              </span>
            </Menu.CheckboxItem>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}
