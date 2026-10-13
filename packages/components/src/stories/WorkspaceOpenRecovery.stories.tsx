import type { Meta, StoryObj } from '@storybook/react';
import type { WorkspaceId } from '@lody/shared';
import type { WorkspaceRuntime } from '@/atoms/runtime';
import { WorkspaceOpenRecoveryPage } from '@/components/workspace-open-placeholder';
import type { WorkspaceDataScopeObservation } from '@/hooks/use-workspace-data-scope-state';

const runtime = {
  workspaceSlug: 'acme',
  workspaceId: 'ws-acme' as WorkspaceId,
} as WorkspaceRuntime;

function observation(
  scope: 'doc_meta_scan_failed' | 'doc_meta_scan_pending'
): WorkspaceDataScopeObservation {
  return {
    targetSlug: 'acme',
    scope: { status: 'switching', targetSlug: 'acme', blocker: scope },
    workspaceId: runtime.workspaceId,
    organizationsReady: true,
    docMetaScanErrorType: scope === 'doc_meta_scan_failed' ? 'UnknownError' : null,
    runtimeInitErrorType: null,
  };
}

const meta: Meta<typeof WorkspaceOpenRecoveryPage> = {
  title: 'Components/WorkspaceOpenRecovery',
  component: WorkspaceOpenRecoveryPage,
  args: {
    layout: 'pane',
    failed: true,
    observation: observation('doc_meta_scan_failed'),
    waitStartedAt: Date.now() - 4_000,
  },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100dvh' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof WorkspaceOpenRecoveryPage>;

/** The local copy could not be read, and today's automatic repair already ran. */
export const Failed: Story = {};

/** Nothing failed, but the workspace has not opened after the recovery delay. */
export const Slow: Story = {
  args: {
    failed: false,
    observation: observation('doc_meta_scan_pending'),
    waitStartedAt: Date.now() - 20_000,
  },
};

/** Before any workspace layout exists: the page is the whole window. */
export const FailedAtBoot: Story = {
  args: { layout: 'window' },
};
