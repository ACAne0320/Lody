import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import type { E2eeWorkspaceRuntime } from '@lody/platform';
import { E2eeLocalAgentApproval } from '@/components/e2ee-local-agent-approval';

const native = (
  protection: 'file' | 'os-keystore',
  ready = true
): Pick<E2eeWorkspaceRuntime, 'prepareLocalAgent' | 'admitLocalAgent'> => ({
  prepareLocalAgent: async () => ({
    pairingSessionId: 'synthetic-local-pairing',
    protection,
    admitted: false,
  }),
  admitLocalAgent: async () => ({ admitted: true, ready }),
});
const meta = {
  title: 'Components/E2eeLocalAgentApproval',
  component: E2eeLocalAgentApproval,
  args: { workspaceId: 'synthetic-workspace', enabled: true, runtime: native('file') },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof E2eeLocalAgentApproval>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Enable: Story = {};
export const FileProtectionConfirmation: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
  },
};
export const OsProtectionConfirmation: Story = {
  args: { runtime: native('os-keystore') },
  play: FileProtectionConfirmation.play,
};
export const ApprovedWaitingForKey: Story = {
  args: { runtime: native('file', false) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    const dialog = await within(document.body).findByRole('alertdialog');
    const buttons = within(dialog).getAllByRole('button');
    await userEvent.click(buttons[buttons.length - 1]!);
  },
};
