import { createApi, createClient, type GenericCtx } from '@convex-dev/better-auth';
import type { ComponentApi } from '@convex-dev/better-auth/_generated/component.js';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { deviceAuthorization } from 'better-auth/plugins';
import { convexTest } from 'convex-test';
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
  type DataModelFromSchemaDefinition,
} from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

// Public Better Auth device schema represented in Convex; no application tables,
// business guards, private context wrapper, or deployment configuration.
const schema = defineSchema({
  deviceCode: defineTable({
    deviceCode: v.string(),
    userCode: v.string(),
    status: v.string(),
    expiresAt: v.number(),
    userId: v.optional(v.union(v.null(), v.string())),
    clientId: v.optional(v.union(v.null(), v.string())),
    scope: v.optional(v.union(v.null(), v.string())),
    pollingInterval: v.optional(v.union(v.null(), v.number())),
    lastPolledAt: v.optional(v.union(v.null(), v.number())),
  })
    .index('userCode', ['userCode'])
    .index('deviceCode', ['deviceCode']),
});
const options: BetterAuthOptions = {
  plugins: [deviceAuthorization({ validateClient: (id) => id === 'test-cli' })],
};
const functions = createApi(schema, () => options);
const refs = {
  create: makeFunctionReference<'mutation'>('adapter:create'),
  findOne: makeFunctionReference<'query'>('adapter:findOne'),
  deleteMany: makeFunctionReference<'mutation'>('adapter:deleteMany'),
};
function fixture() {
  // Module loaders return real registered SDK functions; convex-test applies
  // their actual argument validators and executes their database transactions.
  const t = convexTest(schema, {
    './_generated/server.ts': async () => ({}),
    './adapter.ts': async () => functions,
  });
  const create = (userCode = 'FIRST-CODE', deviceCode = 'first-device-secret') =>
    t.mutation(refs.create, {
      input: {
        model: 'deviceCode',
        data: {
          userCode,
          deviceCode,
          userId: null,
          status: 'pending',
          expiresAt: Date.parse('2030-01-01'),
          clientId: 'test-cli',
          pollingInterval: 5000,
        },
      },
    });
  const client = createClient<DataModelFromSchemaDefinition<typeof schema>, typeof schema>(
    { adapter: refs } as unknown as ComponentApi,
    { local: { schema } }
  );
  const factory = client.adapter({
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as unknown as GenericCtx<DataModelFromSchemaDefinition<typeof schema>>);
  const rows = () => t.run((ctx) => ctx.db.query('deviceCode').collect());
  return { t, create, factory, rows };
}

describe('Better Auth table-level device code unique indexes in the real Convex SDK', () => {
  it.each([
    ['userCode', 'FIRST-CODE', 'different-device-secret'],
    ['deviceCode', 'SECOND-CODE', 'first-device-secret'],
  ])(
    'rejects duplicate %s atomically without changing an existing row',
    async (_field, userCode, deviceCode) => {
      const { create, rows } = fixture();
      await create();
      const original = await rows();
      await expect(create(userCode, deviceCode)).rejects.toThrow(/unique constraint/i);
      expect(await rows()).toEqual(original);
    }
  );

  it.each(['userCode', 'deviceCode'])('fails closed on legacy duplicate %s rows', async (field) => {
    const { t, create, rows } = fixture();
    await create();
    await t.run(async (ctx) => {
      const original = (await ctx.db.query('deviceCode').collect())[0]!;
      const { _id, _creationTime, ...data } = original;
      await ctx.db.insert('deviceCode', {
        ...data,
        ...(field === 'userCode' ? { deviceCode: 'second-secret' } : { userCode: 'SECOND-CODE' }),
      });
    });
    const original = await rows();
    const where = [
      {
        field,
        value: field === 'userCode' ? 'FIRST-CODE' : 'first-device-secret',
      },
    ];
    await expect(t.query(refs.findOne, { model: 'deviceCode', where })).rejects.toThrow();
    await expect(
      t.mutation(refs.deleteMany, {
        input: { model: 'deviceCode', where },
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).rejects.toThrow();
    expect(await rows()).toEqual(original);
  });

  it.each(['userCode', 'deviceCode'])(
    'lets the real device plugin retry a generated %s collision',
    async (field) => {
      const { create, factory, rows } = fixture();
      await create();
      let attempts = 0;
      const auth = betterAuth({
        baseURL: 'http://localhost:3000',
        secret: 'synthetic-public-plugin-test-secret-at-least-32-bytes',
        database: factory,
        plugins: [
          deviceAuthorization({
            validateClient: (id) => id === 'test-cli',
            generateDeviceCode: () => {
              attempts++;
              return field === 'deviceCode' && attempts === 1
                ? 'first-device-secret'
                : `fresh-device-${attempts}`;
            },
            generateUserCode: () =>
              field === 'userCode' && attempts === 1 ? 'FIRST-CODE' : `FRESH-${attempts}`,
          }),
        ],
      });
      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/device/code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: 'test-cli' }),
        })
      );
      expect(response.status).toBe(200);
      expect(attempts).toBe(2);
      expect(await response.json()).toMatchObject({
        device_code: 'fresh-device-2',
        user_code: 'FRESH-2',
      });
      expect(await rows()).toHaveLength(2);
      expect(await rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userCode: 'FIRST-CODE',
            deviceCode: 'first-device-secret',
          }),
        ])
      );
    }
  );
});
