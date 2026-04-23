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
  const [allowRegistrations, setAllowRegistrations] = useState(true);

  useEffect(() => {
    api.getAuthProviders()
      .then((p) => setAuthentik(p.authentik))
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
    const redirectUri = `${window.location.origin}/auth/callback`;
    const params = new URLSearchParams({
      client_id: authentik.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    window.location.href = `${authentik.url}/application/o/authorize/?${params}`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password);
      saveAuth(res.token, res.user);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.box}>
        <div className={styles.logo}>opsatlas</div>
        <p className={styles.tagline}>Multi-cloud infrastructure dashboard</p>

        {authentik?.enabled && (
          <>
            <button type="button" className={styles.ssoBtn} onClick={handleAuthentikLogin}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Sign in with Authentik
            </button>
            <div className={styles.divider}><span>or</span></div>
          </>
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
