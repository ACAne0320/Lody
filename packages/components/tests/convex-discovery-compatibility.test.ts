import { afterEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { convex } from '@convex-dev/better-auth/plugins';

afterEach(() => vi.unstubAllEnvs());

describe('Convex JWT discovery without the removed OIDC provider', () => {
  it('preserves discovery metadata without registering OAuth provider endpoints', async () => {
    vi.stubEnv('CONVEX_SITE_URL', 'https://convex.example.test');
    vi.stubEnv('BETTER_AUTH_BASE_URL', 'https://convex.example.test');
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-with-at-least-thirty-two-characters');
    const auth = betterAuth({
      baseURL: 'https://convex.example.test',
      secret: 'a-test-secret-with-at-least-thirty-two-characters',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      plugins: [
        convex({
          authConfig: {
            providers: [{ applicationID: 'convex', domain: 'https://convex.example.test' }],
          },
        }),
      ],
    });
    const response = await auth.handler(
      new Request('https://convex.example.test/api/auth/convex/.well-known/openid-configuration')
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issuer: 'https://convex.example.test',
      authorization_endpoint: 'https://convex.example.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://convex.example.test/api/auth/oauth2/token',
      userinfo_endpoint: 'https://convex.example.test/api/auth/oauth2/userinfo',
      jwks_uri: 'https://convex.example.test/api/auth/convex/jwks',
      registration_endpoint: 'https://convex.example.test/api/auth/oauth2/register',
      end_session_endpoint: 'https://convex.example.test/api/auth/oauth2/endsession',
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      acr_values_supported: ['urn:mace:incommon:iap:silver', 'urn:mace:incommon:iap:bronze'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['HS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: [
        'sub',
        'iss',
        'aud',
        'exp',
        'nbf',
        'iat',
        'jti',
        'email',
        'email_verified',
        'name',
      ],
    });
    expect('oAuth2authorize' in auth.api).toBe(false);
    expect('oAuth2token' in auth.api).toBe(false);
    expect(
      (await auth.$context).options.plugins?.some((plugin) => plugin.id === 'oidc-provider')
    ).toBe(false);
    expect(
      (await auth.handler(new Request('https://convex.example.test/api/auth/oauth2/authorize')))
        .status
    ).toBe(404);
  });
});
