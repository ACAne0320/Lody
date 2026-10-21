import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';

const AccessSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    userId: z.string().min(1),
    workspaceId: z.string().min(1),
    machineId: z.string().min(1),
  })
  .strict();
export type ExternalAccess = z.infer<typeof AccessSchema>;
export const externalAccessPath = () => path.join(getLodyDataDir(), 'mcp-external-access.json');
export const hashAccessToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function syncPrivateDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Atomic replacement never exposes a partially written credential or receipt. */
export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    await syncPrivateDirectory(path.dirname(file));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readExternalAccess(
  file = externalAccessPath()
): Promise<ExternalAccess | null> {
  try {
    return AccessSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('External MCP access configuration is unreadable', { cause: error });
  }
}

export async function enableExternalAccess(
  scope: Pick<ExternalAccess, 'userId' | 'workspaceId' | 'machineId'>,
  file = externalAccessPath()
) {
  const token = randomBytes(32).toString('base64url');
  const access = AccessSchema.parse({
    version: 1,
    id: randomUUID(),
    tokenHash: hashAccessToken(token),
    ...scope,
  });
  await writePrivateJson(file, access);
  return { access, token };
}

export async function authenticateExternalAccess(token: string, file = externalAccessPath()) {
  const access = await readExternalAccess(file);
  if (!access || token.length > 4096) return null;
  return timingSafeEqual(
    Buffer.from(access.tokenHash, 'hex'),
    Buffer.from(hashAccessToken(token), 'hex')
  )
    ? access
    : null;
}
