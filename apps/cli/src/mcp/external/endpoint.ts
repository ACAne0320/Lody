import { Effect } from 'effect';
import {
  makeLocalProbeClientAuto,
  type LocalProbeClientService,
} from '@lody/shared/node/local-ipc';

/** Read the supervisor's current endpoint; never persist a second copy. */
export const readExternalMcpEndpoint = Effect.fnUntraced(function* (
  probe: LocalProbeClientService = makeLocalProbeClientAuto()
) {
  const health = yield* probe.health({ timeoutMs: 1500 });
  if (health.mcpHttpPort === undefined) {
    return yield* Effect.fail(
      new Error(
        'This daemon does not report its MCP endpoint. Restart it using a version with external MCP support.'
      )
    );
  }
  if (health.mcpHttpPort === null) {
    return yield* Effect.fail(
      new Error(
        'The daemon MCP HTTP host is unavailable. Retry after it starts; check that LODY_MCP_HTTP_DISABLED is not 1.'
      )
    );
  }
  return `http://127.0.0.1:${health.mcpHttpPort}/mcp/external`;
});
