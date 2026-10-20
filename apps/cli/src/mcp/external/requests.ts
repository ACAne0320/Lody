import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';
import { type ExternalAccess, writePrivateJson, syncPrivateDirectory } from './access';

const ReceiptSchema = z
  .object({
    fingerprint: z.string(),
    operationId: z.string(),
    sessionId: z.string(),
    userTurnId: z.string(),
    state: z.enum(['uncertain', 'accepted']),
  })
  .strict();
export type ExternalRequestReceipt = z.infer<typeof ReceiptSchema>;
type Scope = Pick<ExternalAccess, 'userId' | 'workspaceId' | 'machineId'>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

/**
 * A local external request has no parent Session or completion Inbox. A durable
 * claim is made before invoking the existing write service. After an interrupted
 * call we report uncertainty, never replay a potentially dispatched user input.
 * No prompt, token or assistant output is stored in this receipt.
 */
export class ExternalRequests {
  constructor(private readonly root = path.join(getLodyDataDir(), 'mcp-external-requests')) {}

  private file(scope: Scope, operationId: string) {
    return path.join(
      this.root,
      digest([scope.userId, scope.workspaceId, scope.machineId]),
      `${digest(operationId)}.json`
    );
  }

  async get(scope: Scope, operationId: string): Promise<ExternalRequestReceipt | null> {
    try {
      return ReceiptSchema.parse(
        JSON.parse(await fs.readFile(this.file(scope, operationId), 'utf8'))
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw new Error('External request receipt is unreadable', { cause: error });
    }
  }

  async run(
    scope: Scope,
    operationId: string,
    command: unknown,
    targetSessionId: string | undefined,
    execute: (receipt: ExternalRequestReceipt) => Promise<void>,
    validate?: () => Promise<void>
  ): Promise<ExternalRequestReceipt> {
    const file = this.file(scope, operationId);
    const fingerprint = digest(command);
    const prior = await this.get(scope, operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('OPERATION_ID_REUSED: use the original arguments for this operationId');
      return prior;
    }
    await validate?.();
    const receipt: ExternalRequestReceipt = {
      fingerprint,
      operationId,
      sessionId: targetSessionId ?? randomUUID(),
      userTurnId: randomUUID(),
      state: 'uncertain',
    };
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    // Exclusive creation fences duplicate requests, including other processes.
    let handle;
    try {
      handle = await fs.open(file, 'wx', 0o600);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const existing = await this.get(scope, operationId);
      if (!existing || existing.fingerprint !== fingerprint)
        throw new Error('OPERATION_ID_REUSED: use the original arguments for this operationId', {
          cause: error,
        });
      return existing;
    }
    try {
      await handle.writeFile(`${JSON.stringify(receipt)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncPrivateDirectory(path.dirname(file));
    try {
      await execute(receipt);
    } catch {
      // The write may have crossed dispatch. Retain fixed target ids and do not
      // advertise a retry that could duplicate work or erase an accepted input.
      return receipt;
    }
    const accepted = { ...receipt, state: 'accepted' as const };
    await writePrivateJson(file, accepted);
    return accepted;
  }
}

export function publicExternalReceipt(receipt: ExternalRequestReceipt) {
  const { fingerprint: _, ...result } = receipt;
  return {
    ...result,
    ...(receipt.state === 'uncertain'
      ? {
          message:
            'Execution may still be in progress or its outcome is unknown. Inspect this fixed Session/Turn. Retrying this operationId never starts a second write.',
        }
      : {}),
  };
}
