import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import type { ProjectMember, ProjectMemberId } from '@lody/shared';
import { ProjectGroupMemberPicker } from '@/components/chat/project-group-member-picker';

const id = (value: string) => value as ProjectMemberId;

// `lody-oss` is a submodule of `lody`, and `acp-extension-core` a submodule of
// `lody-oss`: two levels, as on disk.
const members: ProjectMember[] = [
  {
    id: id('lody'),
    source: { kind: 'github', repoFullName: 'loro-dev/lody', preferLocal: true },
    placement: { kind: 'root', dir: 'lody' },
  },
  {
    id: id('oss'),
    source: { kind: 'github', repoFullName: 'LodyAI/Lody', preferLocal: true },
    placement: { kind: 'submodule', parent: id('lody'), path: 'lody-oss' },
  },
  {
    id: id('core'),
    source: { kind: 'github', repoFullName: 'LodyAI/acp-extension-core' },
    placement: { kind: 'submodule', parent: id('oss'), path: 'packages/acp-extension-core' },
  },
  {
    id: id('docs'),
    source: { kind: 'github', repoFullName: 'LodyAI/site' },
    placement: { kind: 'root', dir: 'site' },
  },
];

function StatefulPicker(props: { missing?: readonly string[]; canClone?: boolean }) {
  const [excluded, setExcluded] = useState<ReadonlySet<ProjectMemberId>>(new Set());
  return (
    <div style={{ padding: 24, paddingTop: 260 }}>
      <ProjectGroupMemberPicker
        members={members}
        excluded={excluded}
        onExcludedChange={setExcluded}
        labelOf={(member) =>
          member.source.kind === 'github' ? member.source.repoFullName : member.id
        }
        missing={new Set((props.missing ?? []).map(id))}
        canClone={props.canClone}
      />
    </div>
  );
}

const meta = {
  title: 'Chat/ProjectGroupMemberPicker',
  component: StatefulPicker,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button')?.click();
  },
} satisfies Meta<typeof StatefulPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Submodules step in per level and follow their parent. */
export const NestedSubmodules: Story = {};

/** Local-only: a repository this machine has no copy of stays unticked. */
export const MissingOnThisMachine: Story = { args: { missing: ['docs'], canClone: false } };
