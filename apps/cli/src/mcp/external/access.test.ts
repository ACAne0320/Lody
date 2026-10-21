import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticateExternalAccess, enableExternalAccess, readMcpEndpoint } from './access';
import { ExternalRequests, publicExternalReceipt } from './requests';

const scope = { userId: 'owner', workspaceId: 'workspace', machineId: 'machine' };

describe('external MCP credentials and write receipts', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'external-mcp-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports an unavailable endpoint with daemon startup guidance, then reads the published address', async () => {
    const file = path.join(root, 'endpoint.json');
    await expect(readMcpEndpoint(file)).rejects.toThrow('Start or restart the Lody daemon');
    await fs.writeFile(file, JSON.stringify({ port: 45678 }));
    expect(await readMcpEndpoint(file)).toBe('http://127.0.0.1:45678/mcp/external');
  });

  it('rejects malformed endpoint descriptors and distinguishes read failures', async () => {
    const file = path.join(root, 'endpoint.json');
    for (const contents of ['{', '{"port":0}', '{"port":65536}', '{"port":"45678"}']) {
      await fs.writeFile(file, contents);
      await expect(readMcpEndpoint(file)).rejects.toThrow('Local MCP endpoint is invalid');
    }
    await expect(readMcpEndpoint(root)).rejects.toThrow('Local MCP endpoint cannot be read');
  });

  it('binds the token to one scope and revokes it on rotation or removal', async () => {
    const file = path.join(root, 'access.json');
    expect(await authenticateExternalAccess('unknown', file)).toBeNull();
    const first = await enableExternalAccess(scope, file);
    expect(await authenticateExternalAccess(first.token, file)).toMatchObject(scope);
    expect(await authenticateExternalAccess(`${first.token}x`, file)).toBeNull();
    expect(await fs.readFile(file, 'utf8')).not.toContain(first.token);
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const second = await enableExternalAccess({ ...scope, workspaceId: 'other' }, file);
    expect(await authenticateExternalAccess(first.token, file)).toBeNull();
    expect(await authenticateExternalAccess(second.token, file)).toMatchObject({
      workspaceId: 'other',
    });
    await fs.rm(file);
    expect(await authenticateExternalAccess(second.token, file)).toBeNull();
  });

  it('persists receipts across reopening and never re-executes a matching request', async () => {
    const store = new ExternalRequests(root);
    const outputs: string[] = [];
    const first = await store.run(
      scope,
      'request',
      { prompt: 'synthetic', mode: 'test' },
      undefined,
      async (receipt) => {
        outputs.push(receipt.userTurnId);
      }
    );
    const reopened = new ExternalRequests(root);
    const retry = await reopened.run(
      scope,
      'request',
      { mode: 'test', prompt: 'synthetic' },
      undefined,
      async () => {
        outputs.push('duplicate');
      },
      async () => {
        throw new Error('offline');
      }
    );
    expect(first.state).toBe('accepted');
    expect(retry).toEqual(first);
    expect(outputs).toEqual([first.userTurnId]);
    expect(publicExternalReceipt(first)).not.toHaveProperty('fingerprint');
    expect(await reopened.get({ ...scope, userId: 'other' }, 'request')).toBeNull();
    expect(await reopened.get({ ...scope, workspaceId: 'other' }, 'request')).toBeNull();
    await expect(
      reopened.run(scope, 'request', { prompt: 'different' }, undefined, async () => {})
    ).rejects.toThrow('OPERATION_ID_REUSED');
  });

  it('retains uncertainty after a write failure and exposes fixed targets without replay', async () => {
    const store = new ExternalRequests(root);
    const outputs: string[] = [];
    const first = await store.run(
      scope,
      'request',
      { prompt: 'synthetic' },
      'target',
      async (receipt) => {
        outputs.push(receipt.userTurnId);
        throw new Error('Lost acknowledgement after dispatch');
      }
    );
    expect(first).toMatchObject({ state: 'uncertain', sessionId: 'target' });
    const retry = await new ExternalRequests(root).run(
      scope,
      'request',
      { prompt: 'synthetic' },
      'target',
      async () => {
        outputs.push('duplicate');
      }
    );
    expect(retry).toEqual(first);
    expect(outputs).toEqual([first.userTurnId]);
  });

  it('fences a concurrent duplicate while the original write is running', async () => {
    let announce: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new ExternalRequests(root);
    const outputs: string[] = [];
    const pending = store.run(scope, 'request', {}, undefined, async (receipt) => {
      outputs.push(receipt.userTurnId);
      announce();
      await finish;
    });
    await started;
    try {
      const duplicate = await new ExternalRequests(root).run(
        scope,
        'request',
        {},
        undefined,
        async () => {
          outputs.push('duplicate');
        }
      );
      expect(duplicate.state).toBe('uncertain');
      expect(outputs).toEqual([duplicate.userTurnId]);
    } finally {
      release();
      await pending;
    }
    expect((await store.get(scope, 'request'))?.state).toBe('accepted');
  });

  it('does not consume an operation id when preflight rejects', async () => {
    const store = new ExternalRequests(root);
    await expect(
      store.run(
        scope,
        'request',
        {},
        undefined,
        async () => {},
        async () => {
          throw new Error('Invalid target');
        }
      )
    ).rejects.toThrow('Invalid target');
    expect(await store.get(scope, 'request')).toBeNull();
  });
});
