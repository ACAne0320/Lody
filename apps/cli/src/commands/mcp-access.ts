import { readExternalMcpEndpoint } from '@/mcp/external/endpoint';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import { Effect } from 'effect';
import { makeLocalWorkspaceCatalog } from '@/lib/local-workspace-catalog';
import { runOneShotCommand, selectWorkspaceSummary } from '@/lib/command-runtime';
import {
  enableExternalAccess,
  externalAccessPath,
  readExternalAccess,
} from '@/mcp/external/access';

export const mcpAccessCommand = new Command('access')
  .description('Manage access to this installation from other local MCP clients')
  .addCommand(
    new Command('enable')
      .description('Issue a workspace-scoped local token; replaces and revokes the previous token')
      .option('--workspace <selector>', 'Workspace id, slug, or name')
      .action(async (options: { workspace?: string }) => {
        await runOneShotCommand('mcp-access', { json: true }, async () => {
          const catalog = await Effect.runPromise(makeLocalWorkspaceCatalog().read());
          if (!catalog.identity || !catalog.machine) throw new Error('Start the Lody daemon first');
          const workspace = selectWorkspaceSummary(
            catalog.workspaces
              .filter((item) => item.state === 'active')
              .map((item) => ({
                id: item.workspaceId,
                name: item.name,
                slug: item.slug,
                role: item.role,
              })),
            options.workspace
          );
          // Query the running host before replacing a credential.
          const url = await Effect.runPromise(readExternalMcpEndpoint());
          const { token } = await enableExternalAccess({
            userId: catalog.identity.userId,
            machineId: catalog.machine.machineId,
            workspaceId: workspace.id,
          });
          console.log(
            JSON.stringify(
              {
                url,
                headers: { Authorization: `Bearer ${token}` },
                workspaceId: workspace.id,
                notice:
                  'Save this token; it is shown only once. This grants read and task execution access.',
              },
              null,
              2
            )
          );
        });
      })
  )
  .addCommand(
    new Command('status')
      .description('Show endpoint and access scope without revealing credentials')
      .action(async () => {
        await runOneShotCommand('mcp-access', { json: true }, async () => {
          const access = await readExternalAccess();
          console.log(
            JSON.stringify(
              access
                ? {
                    enabled: true,
                    url: await Effect.runPromise(readExternalMcpEndpoint()),
                    workspaceId: access.workspaceId,
                  }
                : { enabled: false }
            )
          );
        });
      })
  )
  .addCommand(
    new Command('disable')
      .description('Revoke access for new external MCP requests; accepted tasks continue')
      .action(async () => {
        await runOneShotCommand('mcp-access', { json: true }, async () => {
          await fs.rm(externalAccessPath(), { force: true });
          console.log(JSON.stringify({ enabled: false }));
        });
      })
  );
