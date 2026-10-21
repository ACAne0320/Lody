// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: {
    user: { id: 'alice', name: 'Alice', email: 'alice@example.test' },
    session: { token: 'alice-token' },
  },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => options,
  useNavigate: () => vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@posthog/react', () => ({ usePostHog: () => null }));
vi.mock('../src/lib/posthog-analytics', () => ({
  capturePostHogEvent: () => {},
  capturePostHogOutcome: () => {},
}));
vi.mock('../src/hooks/useStableSession', () => ({
  useStableSession: () => ({ data: state.session, isPending: false, isRetrying: false }),
}));
vi.mock('../src/lib/app-platform', () => ({ useAppCapability: () => true }));
vi.mock('../src/lib/cloud-http-port', () => ({
  requireCloudAuthBaseUrl: () => 'https://auth.example.test',
}));
vi.mock('../src/components/route-message', () => ({ RouteMessage: () => null }));
// Keep route coverage focused on the network/state boundary; the real view has Storybook coverage.
vi.mock('../src/components/pages/device-auth-page', () => ({
  DeviceAuthPage: (props: any) =>
    createElement(
      'form',
      { onSubmit: props.onSubmit },
      createElement('input', {
        value: props.userCode,
        onChange: (event: any) => props.onUserCodeChange(event.target.value),
      }),
      createElement(
        'output',
        null,
        JSON.stringify({
          request: props.request,
          error: props.error,
          success: props.success,
          denied: props.denied,
        })
      ),
      createElement(
        'button',
        { type: 'submit', disabled: !props.canSubmit || props.isVerifying },
        props.request ? 'Approve' : 'Review'
      ),
      props.request
        ? createElement(
            'button',
            { type: 'button', disabled: props.isVerifying, onClick: props.onDeny },
            'Deny'
          )
        : null
    ),
}));
import { Route } from '../src/routes/device';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let requests: { url: string; method: string; body?: string; token: string | null }[];
let reply: Record<string, unknown>;
let status: number;
const render = async () => act(async () => root.render(createElement((Route as any).component)));
const submit = async () =>
  act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const output = () => JSON.parse(container.querySelector('output')!.textContent!);
beforeEach(async () => {
  state.session = {
    user: { id: 'alice', name: 'Alice', email: 'alice@example.test' },
    session: { token: 'alice-token' },
  };
  window.history.replaceState(null, '', '/device?user_code=ABCD2345&client_id=evil&scope=forged');
  requests = [];
  status = 200;
  reply = { user_code: 'ABCD2345', status: 'pending', client_id: 'lody-cli', scope: 'read  write' };
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    if (url.endsWith('/api/auth/device/deny')) {
      // Validate against the installed plugin, not a duplicated wire DTO.
      const schema = deviceAuthorization().endpoints.deviceDeny.options.body;
      const parsed = schema.safeParse(JSON.parse(options.body as string));
      if (!parsed.success) return new Response('{}', { status: 400 });
    }
    requests.push({
      url,
      method: options.method!,
      body: options.body as string,
      token: new Headers(options.headers).get('Authorization'),
    });
    return new Response(JSON.stringify(options.method === 'GET' ? reply : { success: true }), {
      status,
    });
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('prefilled links require review then explicit approval of server-checked details', async () => {
  expect(requests).toEqual([]);
  expect(container.textContent).toContain('Review');
  await submit();
  expect(output().request).toEqual({
    clientName: 'device.lodyCli',
    clientId: 'lody-cli',
    scope: 'read  write',
  });
  expect(requests.map((r) => r.method)).toEqual(['GET']);
  await submit();
  expect(requests.map((r) => r.method)).toEqual(['GET', 'GET', 'POST']);
  expect(requests[2]).toMatchObject({
    url: 'https://auth.example.test/api/cli/device/approve',
    body: '{"userCode":"ABCD2345"}',
    token: 'Bearer alice-token',
  });
  expect(output().success).toBe(true);
});
it('supports explicit denial without issuing an approval', async () => {
  await submit();
  await act(async () => container.querySelectorAll('button')[1]!.click());
  expect(requests.at(-1)).toMatchObject({
    url: 'https://auth.example.test/api/auth/device/deny',
    body: '{"userCode":"ABCD2345"}',
  });
  expect(output().denied).toBe(true);
});
it.each([
  { client_id: 'evil' },
  { client_id: undefined },
  { scope: null },
  { scope: [] },
  { status: 'approved' },
  { user_code: 'OTHER123' },
])('blocks unverified or invalid request details %j', async (invalid) => {
  Object.assign(reply, invalid);
  await submit();
  await submit();
  expect(output().request).toBeNull();
  expect(output().error).toBe('device.loadFailed');
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
});
it('allows an absent optional scope without implying limited session access', async () => {
  delete reply.scope;
  await submit();
  expect(output().request.scope).toBe('');
});
it('clears the confirmation when the recheck changes or fails', async () => {
  await submit();
  reply.scope = 'different';
  await submit();
  expect(output().request).toBeNull();
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
  status = 403;
  await submit();
  expect(output().error).toBe('device.loadFailed');
});
it('requires new verification after an account or session change', async () => {
  await submit();
  state.session = {
    user: { id: 'bob', name: 'Bob', email: 'bob@example.test' },
    session: { token: 'bob-token' },
  };
  await render();
  expect(output().request).toBeNull();
  await submit();
  expect(requests.at(-1)?.method).toBe('GET');
  expect(requests.at(-1)?.token).toBe('Bearer bob-token');
});
it('ignores an old response after the session changes', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      })
  );
  await submit();
  state.session = {
    user: { id: 'bob', name: 'Bob', email: 'bob@example.test' },
    session: { token: 'bob-token' },
  };
  await render();
  await act(async () => resolve(new Response(JSON.stringify(reply))));
  expect(output().request).toBeNull();
  expect(output().success).toBe(false);
});
