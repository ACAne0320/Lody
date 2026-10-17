import type { Meta, StoryObj } from '@storybook/react';
import type { ProjectMemberId } from '@lody/shared';
import { SessionProjectMembersChip } from '@/components/sessions/session-project-members-chip';
import type { SessionProjectMemberRow } from '@/lib/session-project-members';

const rows: SessionProjectMemberRow[] = [
  {
    id: 'web' as ProjectMemberId,
    path: 'web',
    kind: 'local',
    isSubmodule: false,
    repoFullName: 'acme/web',
    branch: 'lody/export-report',
    dirty: true,
    unpushed: false,
    pr: { url: 'https://github.com/acme/web/pull/412', number: 412, status: 'open', ciState: 'f' },
  },
  {
    id: 'api' as ProjectMemberId,
    path: 'api',
    kind: 'github',
    isSubmodule: false,
    repoFullName: 'acme/api',
    branch: 'lody/export-report',
    dirty: false,
    unpushed: false,
    pr: { url: 'https://github.com/acme/api/pull/88', number: 88, status: 'draft', ciState: 's' },
  },
  {
    id: 'proto' as ProjectMemberId,
    path: 'api/proto',
    kind: 'github',
    isSubmodule: true,
    repoFullName: 'acme/proto',
    branch: 'lody/export-report-proto',
    dirty: false,
    unpushed: true,
  },
];

const meta = {
  title: 'Sessions/SessionProjectMembersChip',
  component: SessionProjectMembersChip,
  args: { groupName: 'Shop', rows, onOpenPullRequest: () => undefined, defaultOpen: true },
  decorators: [
    (Story) => (
      <div className="flex h-[360px] items-end p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionProjectMembersChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every state at once: dirty, unpushed, failing and passing CI, no PR yet. */
export const Mixed: Story = {};

/** Nothing pushed yet: every row says No PR, the summary counts zero. */
export const BeforeAnyPr: Story = {
  args: { rows: rows.map(({ pr: _pr, ...row }) => row) },
};
