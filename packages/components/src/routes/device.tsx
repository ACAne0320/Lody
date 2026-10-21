import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { usePostHog } from '@posthog/react';
import { RouteMessage } from '@/components/route-message';
import { DeviceAuthPage as DeviceAuthPageView } from '@/components/pages/device-auth-page';
import { useStableSession } from '@/hooks/useStableSession';
import { getAppCurrentPathWithSearch, getAppWindowSearchParams } from '@/lib/app-location';
import { capturePostHogEvent, capturePostHogOutcome } from '@/lib/posthog-analytics';
import { useAppCapability } from '@/lib/app-platform';
import { requireCloudAuthBaseUrl } from '@/lib/cloud-http-port';

export const Route = createFileRoute('/device')({
  component: DeviceAuthRoute,
});

/**
 * 设备授权验证页面
 * 用户在此页面输入CLI显示的验证码完成授权
 */
function DeviceAuthRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session, isPending, isRetrying, error } = useStableSession();
  const isAuthenticated = Boolean(session?.user);
  const cloudAccountAvailable = useAppCapability('cloudAccount');
  const [sessionSettled, setSessionSettled] = useState(!isPending);

  useEffect(() => {
    if (!isPending) setSessionSettled(true);
  }, [isPending]);

  // 如果未登录，重定向到登录页
  useEffect(() => {
    if (!cloudAccountAvailable) {
      void navigate({ to: '/', replace: true });
      return;
    }
    if (!isAuthenticated && !isPending) {
      void navigate({
        to: '/login',
        search: { redirect: getAppCurrentPathWithSearch() },
      });
    }
  }, [cloudAccountAvailable, isAuthenticated, isPending, navigate]);

  if (!cloudAccountAvailable) {
    return null;
  }

  if (!sessionSettled) {
    return null;
  }

  if (isPending || isRetrying) {
    return null;
  }

  if (error) {
    return (
      <RouteMessage
        gate="session_load_error"
        title={t('workspace.route.sessionLoadErrorTitle')}
        description={t('workspace.route.sessionLoadErrorDescription')}
      />
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <DeviceAuthInner key={`${session?.user?.id}:${session?.session?.token}`} />;
}

function DeviceAuthInner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const postHog = usePostHog();
  const { data: session } = useStableSession();
  const [hasPrefilledCode] = useState(() => {
    const params = getAppWindowSearchParams();
    return Boolean(params.get('user_code') ?? params.get('code'));
  });
  const [userCode, setUserCode] = useState(() => {
    const params = getAppWindowSearchParams();
    const code = params.get('user_code') ?? params.get('code');
    return code ? code.toUpperCase() : '';
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [request, setRequest] = useState<{ clientId: string; scope: string; code: string } | null>(
    null
  );
  const [denied, setDenied] = useState(false);
  const inFlight = useRef(false);
  const currentIdentity = useRef({ token: session?.session?.token, code: '' });

  const normalizedUserCode = userCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  currentIdentity.current = { token: session?.session?.token, code: normalizedUserCode };
  useEffect(
    () => () => {
      currentIdentity.current = { token: undefined, code: '' };
    },
    []
  );

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) {
      return;
    }
    viewedRef.current = true;
    capturePostHogEvent(postHog, 'auth/device_auth_viewed', {
      has_prefilled_code: hasPrefilledCode,
    });
  }, [hasPrefilledCode, postHog]);

  // 授权成功后倒计时跳转到主页
  useEffect(() => {
    if (!success) return undefined;

    if (countdown <= 0) {
      void navigate({ to: '/' });
      return undefined;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [success, countdown, navigate]);

  const handleSubmit = async (e: React.FormEvent, deny = false) => {
    e.preventDefault();
    if (inFlight.current || normalizedUserCode.length !== 8) return;
    inFlight.current = true;
    setError(null);
    setIsVerifying(true);
    const sessionToken = session?.session?.token;
    const code = normalizedUserCode;
    const stillCurrent = () =>
      currentIdentity.current.token === sessionToken && currentIdentity.current.code === code;
    try {
      if (!sessionToken) throw new Error(t('device.loadFailed'));
      const authBaseUrl = requireCloudAuthBaseUrl('cloudAccount');
      const verificationUrl = new URL('/api/auth/device', authBaseUrl);
      verificationUrl.searchParams.set('user_code', code);
      const verificationRes = await fetch(verificationUrl.toString(), {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!verificationRes.ok) throw new Error(t('device.loadFailed'));
      const data: unknown = await verificationRes.json();
      if (!stillCurrent()) return;
      if (!data || typeof data !== 'object') throw new Error(t('device.loadFailed'));
      const checked = data as Record<string, unknown>;
      // Only this server-returned identifier can select the trusted display name.
      // Public client IDs do not prove that a device is owned by the user.
      if (
        checked.status !== 'pending' ||
        checked.user_code !== code ||
        checked.client_id !== 'lody-cli' ||
        (checked.scope !== undefined && typeof checked.scope !== 'string')
      ) {
        throw new Error(t('device.loadFailed'));
      }
      const verified = { clientId: checked.client_id, scope: checked.scope ?? '', code };
      if (!request) {
        setRequest(verified);
        return;
      }
      // Recheck before approval; never approve changed or previously unseen details.
      if (
        request.code !== code ||
        request.clientId !== verified.clientId ||
        request.scope !== verified.scope
      ) {
        throw new Error(t('device.loadFailed'));
      }
      const url = new URL(deny ? '/api/auth/device/deny' : '/api/cli/device/approve', authBaseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ userCode: code }),
      });
      if (!response.ok) throw new Error(t('device.loadFailed'));
      if (!stillCurrent()) return;
      if (deny) setDenied(true);
      else {
        capturePostHogOutcome(postHog, 'auth/device_auth_succeeded', 'success', {
          has_prefilled_code: hasPrefilledCode,
        });
        setSuccess(true);
      }
    } catch {
      if (stillCurrent()) {
        setRequest(null);
        setError(t('device.loadFailed'));
      }
    } finally {
      inFlight.current = false;
      if (stillCurrent()) setIsVerifying(false);
    }
  };

  return (
    <DeviceAuthPageView
      userLabel={`${t('device.loginAs')} ${session?.user?.name} (${session?.user?.email})`}
      userCode={userCode}
      error={error}
      success={success}
      countdown={countdown}
      denied={denied}
      request={
        request
          ? { clientName: t('device.lodyCli'), clientId: request.clientId, scope: request.scope }
          : null
      }
      onDeny={(event) => {
        void handleSubmit(event, true);
      }}
      isVerifying={isVerifying}
      canSubmit={normalizedUserCode.length === 8}
      onUserCodeChange={(value) => {
        setUserCode(value.toUpperCase());
        setRequest(null);
        setError(null);
      }}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    />
  );
}
