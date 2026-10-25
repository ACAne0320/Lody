import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import * as stylex from '@stylexjs/stylex';
import type {
  LocalProjectId,
  MachineId,
  SessionId,
  LocalProjectWorktreeCleanupPreflightResult,
} from '@lody/shared';
import { Button } from '@lody/ui/button';
import { RemoveLocalProjectDialog } from '@/components/loro-app-sidebar';
import { themeColors } from '../style/theme-colors.stylex';
import { themeSpace } from '../style/theme-scale.stylex';

const styles = stylex.create({
  canvas: {
    minHeight: '100vh',
    padding: themeSpace[4],
    backgroundColor: themeColors.background,
    color: themeColors.foreground,
  },
});
const result: LocalProjectWorktreeCleanupPreflightResult = {
  clean: [
    {
      sessionId: 'alpha-clean' as SessionId,
      title: 'Clean synthetic session',
      path: '/synthetic/worktrees/clean',
    },
  ],
  dirty: [
    {
      sessionId: 'alpha-dirty' as SessionId,
      title: 'Dirty synthetic session 中文',
      path: '/synthetic/worktrees/dirty',
    },
  ],
  failed: [
    {
      sessionId: 'alpha-failed' as SessionId,
      title: 'Unavailable synthetic session',
      path: '/synthetic/worktrees/unavailable',
      message: 'Synthetic permission failure',
    },
  ],
};
function Fixture({
  mode = 'local',
}: {
  mode?: 'local' | 'offline' | 'unavailable' | 'error' | 'processing';
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('No removal requested');
  return (
    <div {...stylex.props(styles.canvas)}>
      <Button onClick={() => setOpen(true)}>Open project removal</Button>
      <output data-alpha-sidebar-output>{outcome}</output>
      <RemoveLocalProjectDialog
        open={open}
        onOpenChange={setOpen}
        target={{
          machineId: 'alpha-machine' as MachineId,
          localProjectId: 'alpha-project' as LocalProjectId,
          name: 'Synthetic project 中文 with a long project name',
          pathLabel: '/synthetic/projects/very-long-directory/原始项目/stays-on-disk',
          conversationCount: 3,
          runningSessionCount: 1,
        }}
        isRemote={mode === 'offline'}
        machineName="Synthetic offline workstation"
        deviceOnline={mode !== 'offline'}
        canCleanupWorktrees={mode !== 'unavailable' && mode !== 'offline'}
        isRemoving={mode === 'processing'}
        onPreflightCleanup={async () => {
          if (mode === 'error')
            throw new Error('Synthetic preflight failed; the original directory remains safe.');
          return result;
        }}
        onConfirm={({ cleanupWorktrees }) => {
          setOutcome(`Synthetic removal requested; cleanup=${cleanupWorktrees}`);
          setOpen(false);
        }}
      />
    </div>
  );
}
const meta = {
  title: 'Sidebar/AlphaMigration',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Local: Story = { render: () => <Fixture /> };
export const Offline: Story = { render: () => <Fixture mode="offline" /> };
export const Unavailable: Story = { render: () => <Fixture mode="unavailable" /> };
export const PreflightError: Story = { render: () => <Fixture mode="error" /> };
export const Processing: Story = { render: () => <Fixture mode="processing" /> };
