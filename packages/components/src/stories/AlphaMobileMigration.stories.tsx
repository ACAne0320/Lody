import type { Meta, StoryObj } from '@storybook/react';
import { useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { LocalProjectWorktreeCleanupPreflightResult, SessionId } from '@lody/shared';
import { Button } from '@lody/ui/button';
import {
  MobileSessionTabSheet,
  type ConversationTabEntry,
  type ViewerTabEntry,
} from '../components/mobile/mobile-session-tab-sheet';
import { MobileRemoveLocalProjectSheet } from '../components/mobile/mobile-remove-local-project-sheet';
import { themeColors } from '../style/theme-colors.stylex';
import { themeSpace } from '../style/theme-scale.stylex';

const styles = stylex.create({
  canvas: {
    minHeight: '100dvh',
    padding: themeSpace[4],
    color: themeColors.foreground,
    backgroundColor: themeColors.background,
  },
  toolbar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: themeSpace[3] },
});
const conversations: ConversationTabEntry[] = [
  {
    id: 'main',
    title: 'Main synthetic conversation 中文',
    active: true,
    main: true,
    running: false,
    unread: false,
    lastActivityAt: null,
  },
  {
    id: 'idle',
    title: 'Idle secondary conversation',
    active: false,
    running: false,
    unread: false,
    lastActivityAt: null,
  },
  {
    id: 'working',
    title: 'Working synthetic conversation',
    active: false,
    running: true,
    unread: false,
    lastActivityAt: null,
  },
  {
    id: 'waiting',
    title: 'Waiting permission outranks working',
    active: false,
    running: true,
    waitingPermission: true,
    unread: true,
    lastActivityAt: null,
  },
  {
    id: 'unread',
    title: 'Unread synthetic conversation',
    active: false,
    running: false,
    unread: true,
    lastActivityAt: null,
  },
  {
    id: 'long',
    title:
      '很长的中文会话标题 / A long conversation title verifies clipping and the unchanged status-slot geometry at narrow widths',
    active: false,
    running: false,
    unread: false,
    lastActivityAt: null,
  },
];
const viewers: ViewerTabEntry[] = [
  { id: 'files', label: 'Files', kind: 'files', active: false },
  { id: 'file', label: 'very-long-file-name-with-中文-and-a-path.tsx', kind: 'file', active: true },
  { id: 'diff', label: 'All changes', kind: 'diff', active: false },
  { id: 'pr', label: 'Synthetic pull request', kind: 'pr', active: false },
  { id: 'browser', label: 'Browser', kind: 'browser', active: false },
];
function TabsFixture({
  compact = false,
  empty = false,
  readOnly = false,
}: {
  compact?: boolean;
  empty?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [action, setAction] = useState('Ready');
  const [items, setItems] = useState(conversations);
  return (
    <div {...stylex.props(styles.canvas)}>
      <div {...stylex.props(styles.toolbar)}>
        <Button onClick={() => setOpen(true)}>Open session tabs</Button>
        <output data-alpha-tabs-output>{action}</output>
      </div>
      <MobileSessionTabSheet
        open={open}
        onOpenChange={setOpen}
        conversations={empty ? [] : compact ? items.slice(0, 2) : items}
        archivedConversations={
          readOnly
            ? []
            : [
                {
                  id: 'closed',
                  title: 'Closed synthetic conversation',
                  lastActivityAt: Date.parse('2026-10-01T09:00:00Z'),
                },
                {
                  id: 'archived',
                  title: 'Archived synthetic conversation',
                  lastActivityAt: Date.parse('2026-10-01T09:00:00Z'),
                  restoresArchive: true,
                  unread: true,
                },
              ]
        }
        viewers={empty || compact ? [] : viewers}
        onSelectConversation={(id) => {
          setItems((current) => current.map((c) => ({ ...c, active: c.id === id })));
          setAction(`Selected: ${id}`);
        }}
        onSelectViewer={(id) => setAction(`Viewer: ${id}`)}
        onNewConversation={readOnly ? undefined : () => setAction('New conversation')}
        onRestoreConversation={(id) => setAction(`Restored: ${id}`)}
        onCloseConversation={
          readOnly
            ? undefined
            : (id) => {
                setItems((current) => current.filter((c) => c.id !== id));
                setAction(`Closed: ${id}`);
              }
        }
      />
    </div>
  );
}
const preflight: LocalProjectWorktreeCleanupPreflightResult = {
  clean: [
    {
      sessionId: 'synthetic-clean' as SessionId,
      title: 'Clean synthetic worktree',
      path: '/synthetic/worktrees/clean',
    },
  ],
  dirty: [
    {
      sessionId: 'synthetic-dirty' as SessionId,
      title: 'Dirty synthetic worktree 中文',
      path: '/synthetic/worktrees/dirty',
    },
  ],
  failed: [
    {
      sessionId: 'synthetic-failed' as SessionId,
      title: 'Unreadable synthetic worktree',
      path: '/synthetic/worktrees/failed',
      message: 'Synthetic inspection failure',
    },
  ],
};
type RemovalMode = 'default' | 'offline' | 'empty' | 'error' | 'pending' | 'removing' | 'long';
function RemovalFixture({ mode = 'default' }: { mode?: RemovalMode }) {
  const [open, setOpen] = useState(true);
  const [action, setAction] = useState('Ready');
  const settlePreflight = useRef<
    ((value: LocalProjectWorktreeCleanupPreflightResult) => void) | null
  >(null);
  const settleRemove = useRef<((value: boolean) => void) | null>(null);
  const offline = mode === 'offline';
  return (
    <div {...stylex.props(styles.canvas)}>
      <div {...stylex.props(styles.toolbar)}>
        <Button onClick={() => setOpen(true)}>Open removal sheet</Button>
        <output data-alpha-remove-output>{action}</output>
      </div>
      <MobileRemoveLocalProjectSheet
        open={open}
        onOpenChange={setOpen}
        projectName={
          mode === 'long'
            ? 'Very long synthetic project name 中文 · preserves wrapping without redesign'
            : 'Synthetic project 中文'
        }
        pathLabel={
          mode === 'empty'
            ? null
            : mode === 'long'
              ? `/synthetic/${'deeply-nested-directory-中文/'.repeat(5)}project`
              : '/synthetic/projects/example'
        }
        deviceName={mode === 'empty' ? '   ' : 'Synthetic Mac 中文'}
        deviceOnline={!offline}
        conversationCount={mode === 'empty' ? 0 : 12}
        runningSessionCount={mode === 'empty' ? 0 : 2}
        canCleanupWorktrees={!offline}
        onPreflightCleanup={async () => {
          setAction('Preflight requested');
          if (mode === 'error') throw new Error('Synthetic inspection error');
          if (mode === 'pending')
            return new Promise((resolve) => {
              settlePreflight.current = resolve;
            });
          return preflight;
        }}
        onConfirm={async (options) => {
          setAction(`Removal requested: cleanup=${options.cleanupWorktrees}`);
          if (mode === 'removing')
            return new Promise((resolve) => {
              settleRemove.current = resolve;
            });
          return mode !== 'error';
        }}
      />
    </div>
  );
}
const meta = {
  title: 'Mobile/AlphaMobileMigration',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const TabsAllStates: Story = { render: () => <TabsFixture /> };
export const TabsCompact: Story = { render: () => <TabsFixture compact /> };
export const TabsEmpty: Story = { render: () => <TabsFixture empty /> };
export const TabsReadOnly: Story = { render: () => <TabsFixture readOnly /> };
export const RemovalDefault: Story = { render: () => <RemovalFixture /> };
export const RemovalOffline: Story = { render: () => <RemovalFixture mode="offline" /> };
export const RemovalEmpty: Story = { render: () => <RemovalFixture mode="empty" /> };
export const RemovalError: Story = { render: () => <RemovalFixture mode="error" /> };
export const RemovalPending: Story = { render: () => <RemovalFixture mode="pending" /> };
export const RemovalInFlight: Story = { render: () => <RemovalFixture mode="removing" /> };
export const RemovalLong: Story = { render: () => <RemovalFixture mode="long" /> };
