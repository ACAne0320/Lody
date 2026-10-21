import { beforeEach, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins/bearer';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';

function createAuth() {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'synthetic-device-test-secret-at-least-32-characters',
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      deviceCode: [],
    }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    plugins: [
      bearer(),
      deviceAuthorization({
        validateClient: (clientId) => clientId === 'lody-cli',
        generateUserCode: () => 'ABCD2345',
      }),
    ],
  });
}
let auth: ReturnType<typeof createAuth>;
let aliceToken: string;
let bobToken: string;
let deviceCode: string;
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});
async function send(path: string, token: string, body?: object) {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: headers(token),
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}
beforeEach(async () => {
  auth = createAuth();
  const signup = async (name: string) =>
    (
      await auth.api.signUpEmail({
        body: { name, email: `${name}@example.test`, password: 'synthetic-valid-password' },
      })
    ).token!;
  aliceToken = await signup('alice');
  bobToken = await signup('bob');
  const code = await auth.api.deviceCode({ body: { client_id: 'lody-cli', scope: 'read  write' } });
  deviceCode = code.device_code;
});
it('exposes checked client and exact scope only to the account claiming the code', async () => {
  const anonymous = await send('/device?user_code=ABCD2345', '');
  expect(await anonymous.json()).not.toHaveProperty('client_id');
  const claimed = await send('/device?user_code=ABCD2345', aliceToken);
  expect(await claimed.json()).toMatchObject({
    status: 'pending',
    client_id: 'lody-cli',
    scope: 'read  write',
  });
  const other = await send('/device?user_code=ABCD2345', bobToken);
  expect(await other.json()).not.toHaveProperty('client_id');
  expect((await send('/device/approve', bobToken, { userCode: 'ABCD2345' })).ok).toBe(false);
});
it('denies using the actual camelCase endpoint contract and prevents redemption', async () => {
  await send('/device?user_code=ABCD2345', aliceToken);
  expect((await send('/device/deny', aliceToken, { user_code: 'ABCD2345' })).ok).toBe(false);
  expect((await send('/device/deny', bobToken, { userCode: 'ABCD2345' })).ok).toBe(false);
  expect((await send('/device/deny', aliceToken, { userCode: 'ABCD2345' })).ok).toBe(true);
  const redeem = await send('/device/token', '', {
    client_id: 'lody-cli',
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  expect(redeem.ok).toBe(false);
});
it('approves only a claimed code and returns an account session usable by bearer auth once', async () => {
  expect((await send('/device/approve', aliceToken, { userCode: 'ABCD2345' })).ok).toBe(false);
  await send('/device?user_code=ABCD2345', aliceToken);
  expect((await send('/device/approve', aliceToken, { userCode: 'ABCD2345' })).ok).toBe(true);
  const body = {
    client_id: 'lody-cli',
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  };
  const response = await send('/device/token', '', body);
  expect(response.ok).toBe(true);
  const token = (await response.json()).access_token;
  const session = await send('/get-session', token);
  expect((await session.json()).user.email).toBe('alice@example.test');
  expect((await send('/device/token', '', body)).ok).toBe(false);
});
it('rejects public identifiers outside the client allowlist', async () => {
  expect((await send('/device/code', '', { client_id: 'attacker-client' })).ok).toBe(false);
});
