'use client';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authentik, setAuthentik] = useState<{ enabled: boolean; url?: string; clientId?: string } | null>(null);
  const [google, setGoogle] = useState<{ enabled: boolean; clientId?: string } | null>(null);
  const [allowRegistrations, setAllowRegistrations] = useState(true);

  // MFA second-step state
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    api.getAuthProviders()
      .then((p) => { setAuthentik(p.authentik); setGoogle(p.google); })
      .catch(() => { /* non-fatal */ });

    api.getServerConfig()
      .then((cfg) => {
        setAllowRegistrations(cfg.allowRegistrations ?? true);
        if (!cfg.allowRegistrations) setMode('login');
      })
      .catch(() => setAllowRegistrations(true));

    // Pick up errors forwarded from callback page
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(decodeURIComponent(err));
  }, []);

  function handleAuthentikLogin() {
    if (!authentik?.url || !authentik.clientId) return;
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_provider', 'authentik');
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const params = new URLSearchParams({
      client_id: authentik.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    window.location.href = `${authentik.url}/application/o/authorize/?${params}`;
  }

  function handleGoogleLogin() {
    if (!google?.clientId) return;
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_provider', 'google');
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password);

      if ('mfa_required' in res && res.mfa_required) {
        setMfaToken(res.mfa_token);
        setMfaCode('');
        return;
      }

      const authRes = res as { token: string; user: { id: string; email: string } };
      saveAuth(authRes.token, authRes.user);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.confirmMfa(mfaToken!, mfaCode);
      saveAuth(res.token, res.user);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  // MFA confirmation step
  if (mfaToken) {
    return (
      <div className={styles.container}>
        <div className={styles.box}>
          <div className={styles.logo}>opsatlas</div>
          <p className={styles.tagline}>Two-factor authentication</p>
          <form onSubmit={handleMfaSubmit} className={styles.form}>
            <div className={styles.field}>
              <label>Authenticator code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
                autoComplete="one-time-code"
                style={{ letterSpacing: '0.2em', fontSize: '1.375rem', textAlign: 'center' }}
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading || mfaCode.length !== 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              style={{ width: '100%', marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8125rem' }}
              onClick={() => { setMfaToken(null); setError(''); }}
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.box}>
        <div className={styles.logo}>opsatlas</div>
        <p className={styles.tagline}>Multi-cloud infrastructure dashboard</p>

        {authentik?.enabled && (
          <button type="button" className={styles.ssoBtn} onClick={handleAuthentikLogin}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Sign in with Authentik
          </button>
        )}

        {google?.enabled && (
          <button type="button" className={styles.ssoBtn} onClick={handleGoogleLogin}>
            <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        )}

        {(authentik?.enabled || google?.enabled) && (
          <div className={styles.divider}><span>or</span></div>
        )}

        {allowRegistrations && (
          <div className={styles.tabs}>
            <button
              className={mode === 'login' ? styles.tabActive : styles.tab}
              onClick={() => setMode('login')}
              type="button"
            >
              Sign in
            </button>
            <button
              className={mode === 'register' ? styles.tabActive : styles.tab}
              onClick={() => setMode('register')}
              type="button"
            >
              Create account
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
