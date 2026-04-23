'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { saveAuth } from '@/lib/auth';

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(`Authentication cancelled: ${errorParam}`);
      return;
    }

    if (!code) {
      setError('No authorization code received.');
      return;
    }

    // Verify state to prevent CSRF
    const storedState = sessionStorage.getItem('oauth_state');
    if (!storedState || storedState !== state) {
      setError('Invalid state parameter. Please try signing in again.');
      return;
    }
    sessionStorage.removeItem('oauth_state');

    const redirectUri = `${window.location.origin}/auth/callback`;

    api.authentikCallback(code, redirectUri)
      .then((res) => {
        saveAuth(res.token, res.user);
        router.replace('/dashboard');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <p style={{ color: 'var(--error, #ef4444)', marginBottom: 16 }}>{error}</p>
          <a href="/login" style={{ color: 'var(--accent)', fontSize: 14 }}>Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}
