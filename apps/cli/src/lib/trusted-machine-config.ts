import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';
import { withFileLock } from '@lody/shared/node/file-lock';
import {
  canonicalExecutionJson,
  type MachineExecutionIntent,
  isWorkspaceMcpServerMeta,
  type AgentConfigMeta,
  type WorkspaceMcpServerMeta,
} from '@lody/shared';

/** Only the authenticated OS-local control endpoint may mint these proofs. */
export class LocalExecutionAuthority {
  constructor(private readonly root = join(getLodyDataDir(), 'local-execution-authority')) {}
  private async key(): Promise<Buffer> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, 'key');
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, randomBytes(32), { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await unlink(temporary);
    }
    return readFile(path);
  }
  async authorize(intent: MachineExecutionIntent, ownerUserId: string): Promise<string> {
    const signature = createHmac('sha256', await this.key())
      .update(canonicalExecutionJson({ intent, ownerUserId }))
      .digest('hex');
    return `local-execution-v1.${signature}`;
  }
  async verify(
    intent: MachineExecutionIntent,
    ownerUserId: string,
    proof: string
  ): Promise<boolean> {
    if (!/^local-execution-v1\.[a-f0-9]{64}$/.test(proof)) return false;
    const expected = await this.authorize(intent, ownerUserId);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(proof));
  }
}

/** MCP snapshots are accepted only through authenticated owner configuration writes. */
export class TrustedMcpConfigStore {
  constructor(private readonly root = join(getLodyDataDir(), 'trusted-mcp-config')) {}

  private path(workspaceId: string, ownerUserId: string, serverId: string): string {
    return join(
      this.root,
      `${createHash('sha256')
        .update(JSON.stringify([workspaceId, ownerUserId, serverId]))
        .digest('hex')}.json`
    );
  }

  async read(
    workspaceId: string,
    ownerUserId: string,
    serverId: string
  ): Promise<WorkspaceMcpServerMeta | null> {
    try {
      const value: unknown = JSON.parse(
        await readFile(this.path(workspaceId, ownerUserId, serverId), 'utf8')
      );
      if (!isWorkspaceMcpServerMeta(value) || value.id !== serverId)
        throw new Error('Trusted MCP scope mismatch');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(
    workspaceId: string,
    ownerUserId: string,
    entry: WorkspaceMcpServerMeta
  ): Promise<WorkspaceMcpServerMeta> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(workspaceId, ownerUserId, entry.id);
    return withFileLock(
      createHash('sha256').update(target).digest('hex'),
      async () => {
        const current = await this.read(workspaceId, ownerUserId, entry.id);
        if (current && (current.executionRevision ?? 0) >= (entry.executionRevision ?? 0))
          return current;
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
        await rename(temporary, target);
        return entry;
      },
      { locksDir: join(this.root, 'locks') }
    );
  }
}

/** Host-local authority. Replicated catalog writes must never populate this store. */
export class TrustedMachineConfigStore {
  constructor(private readonly root = join(getLodyDataDir(), 'trusted-machine-config')) {}

  private path(workspaceId: string, machineId: string, configId: string): string {
    return join(
      this.root,
      `${createHash('sha256')
        .update(JSON.stringify([workspaceId, machineId, configId]))
        .digest('hex')}.json`
    );
  }

  async read(
    workspaceId: string,
    machineId: string,
    configId: string
  ): Promise<AgentConfigMeta | null> {
    try {
      const config = JSON.parse(
        await readFile(this.path(workspaceId, machineId, configId), 'utf8')
      ) as AgentConfigMeta;
      if (config.id !== configId || config.machineId !== machineId)
        throw new Error('Trusted Provider scope mismatch');
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(workspaceId: string, machineId: string, config: AgentConfigMeta): Promise<void> {
    if (config.machineId !== machineId) throw new Error('Provider machine mismatch');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(workspaceId, machineId, config.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
    await rename(temporary, target);
  }
}

/** Durable admission fence: Streams terminal flags are not replay protection. */
export class MachineExecutionReceipts {
  constructor(private readonly root = join(getLodyDataDir(), 'machine-execution-receipts')) {}

  async claim(scope: readonly string[]): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const name = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    try {
      await writeFile(join(this.root, name), '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('Execution was already admitted. Send a new request to retry.', {
          cause: error,
        });
      throw error;
    }
  }
}

export class TrustedNativeSessions {
  constructor(private readonly root = join(getLodyDataDir(), 'trusted-native-sessions')) {}
  private path(scope: readonly string[]): string {
    return join(this.root, createHash('sha256').update(JSON.stringify(scope)).digest('hex'));
  }
  async read(scope: readonly string[]): Promise<string | undefined> {
    try {
      return await readFile(this.path(scope), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async write(scope: readonly string[], nativeId: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(scope);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, nativeId, { mode: 0o600 });
    await rename(temporary, target);
  }
}
