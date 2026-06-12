'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import styles from './settings.module.css';

export default function SsoTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // Form state
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasExistingSecret, setHasExistingSecret] = useState(false);
  const [changeSecret, setChangeSecret] = useState(false);

  useEffect(() => {
    api.getSsoConfig()
      .then((cfg) => {
        setUrl(cfg.authentik.url);
        setClientId(cfg.authentik.clientId);
        setHasExistingSecret(cfg.authentik.hasSecret);
        setEnabled(!!(cfg.authentik.url && cfg.authentik.clientId && cfg.authentik.hasSecret));
      })
      .catch(() => { /* non-fatal — leave fields empty */ })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !clientId.trim()) {
      toast('error', 'URL and Client ID are required');
      return;
    }
    if (!hasExistingSecret && !clientSecret.trim()) {
      toast('error', 'Client secret is required');
      return;
    }
    setSaving(true);
    try {
      const payload: { url: string; clientId: string; clientSecret?: string } = {
        url: url.trim(),
        clientId: clientId.trim(),
      };
      if (changeSecret || !hasExistingSecret) {
        payload.clientSecret = clientSecret;
      }
      await api.saveSsoConfig(payload);
      setHasExistingSecret(true);
      setChangeSecret(false);
      setClientSecret('');
      setEnabled(true);
      toast('success', 'Authentik SSO configuration saved');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function testSso() {
    if (!url || !clientId) return;
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_provider', 'authentik');
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    window.open(`${url}/application/o/authorize/?${params}`, '_blank');
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Single Sign-On</div>
          <div className={styles.sectionDesc}>Configure SSO providers for your team</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          Authentik
          {!loading && (
            <span className={`badge ${enabled ? 'badge-active' : 'badge-pending'}`}>
              {enabled ? 'Configured' : 'Not configured'}
            </span>
          )}
          {enabled && (
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px', marginLeft: 'auto' }} onClick={testSso}>
              Test login
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : (
          <form onSubmit={handleSave} className={styles.ssoForm}>
            <div className={styles.ssoField}>
              <label className={styles.ssoFieldLabel}>Authentik URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://auth.example.com"
                className={styles.ssoInput}
              />
            </div>
            <div className={styles.ssoField}>
              <label className={styles.ssoFieldLabel}>Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="your-client-id"
                className={styles.ssoInput}
              />
            </div>
            <div className={styles.ssoField}>
              <label className={styles.ssoFieldLabel}>Client Secret</label>
              {hasExistingSecret && !changeSecret ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={styles.ssoSecretMasked}>••••••••••••</span>
                  <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => setChangeSecret(true)}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={hasExistingSecret ? 'Enter new secret' : 'your-client-secret'}
                    className={styles.ssoInput}
                    style={{ flex: 1 }}
                    autoFocus={changeSecret}
                  />
                  {hasExistingSecret && (
                    <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => { setChangeSecret(false); setClientSecret(''); }}>
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        <div className={styles.ssoInstructions}>
          <strong>Authentik setup</strong>
          <ol>
            <li>In Authentik, create an <em>OAuth2/OpenID Provider</em> application</li>
            <li>Set the redirect URI to <code>{typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'}/oauth/callback</code></li>
            <li>Enable scopes: <code>openid email profile</code></li>
          </ol>
        </div>
      </div>

      <GoogleSsoCard />
    </section>
  );
}

function GoogleSsoCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasExistingSecret, setHasExistingSecret] = useState(false);
  const [changeSecret, setChangeSecret] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState('');

  useEffect(() => {
    api.getGoogleConfig()
      .then((cfg) => {
        setClientId(cfg.clientId);
        setHasExistingSecret(cfg.hasSecret);
        setAllowedDomain(cfg.allowedDomain);
        setEnabled(!!(cfg.clientId && cfg.hasSecret));
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId.trim()) { toast('error', 'Client ID is required'); return; }
    if (!hasExistingSecret && !clientSecret.trim()) { toast('error', 'Client secret is required'); return; }
    setSaving(true);
    try {
      const payload: { clientId: string; clientSecret?: string; allowedDomain?: string } = {
        clientId: clientId.trim(),
        allowedDomain: allowedDomain.trim(),
      };
      if (changeSecret || !hasExistingSecret) payload.clientSecret = clientSecret;
      await api.saveGoogleConfig(payload);
      setHasExistingSecret(true);
      setChangeSecret(false);
      setClientSecret('');
      setEnabled(true);
      toast('success', 'Google OAuth configuration saved');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function testGoogle() {
    if (!clientId) return;
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_provider', 'google');
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
    });
    window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, '_blank');
  }

  return (
    <div className={styles.card} style={{ marginTop: 16 }}>
      <div className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        Google Workspace
        {!loading && (
          <span className={`badge ${enabled ? 'badge-active' : 'badge-pending'}`}>
            {enabled ? 'Configured' : 'Not configured'}
          </span>
        )}
        {enabled && (
          <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px', marginLeft: 'auto' }} onClick={testGoogle}>
            Test login
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
      ) : (
        <form onSubmit={handleSave} className={styles.ssoForm}>
          <div className={styles.ssoField}>
            <label className={styles.ssoFieldLabel}>Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="000000000000-xxxx.apps.googleusercontent.com"
              className={styles.ssoInput}
            />
          </div>
          <div className={styles.ssoField}>
            <label className={styles.ssoFieldLabel}>Client Secret</label>
            {hasExistingSecret && !changeSecret ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={styles.ssoSecretMasked}>••••••••••••</span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => setChangeSecret(true)}>
                  Change
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={hasExistingSecret ? 'Enter new secret' : 'GOCSPX-…'}
                  className={styles.ssoInput}
                  style={{ flex: 1 }}
                  autoFocus={changeSecret}
                />
                {hasExistingSecret && (
                  <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => { setChangeSecret(false); setClientSecret(''); }}>
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
          <div className={styles.ssoField}>
            <label className={styles.ssoFieldLabel}>Allowed domain <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              value={allowedDomain}
              onChange={(e) => setAllowedDomain(e.target.value)}
              placeholder="yourcompany.com"
              className={styles.ssoInput}
            />
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Restrict sign-in to this Google Workspace domain. Leave empty to allow any Google account.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.ssoInstructions}>
        <strong>Google Cloud Console setup</strong>
        <ol>
          <li>Go to <em>APIs &amp; Services → Credentials</em> and create an OAuth 2.0 Client ID</li>
          <li>Set the redirect URI to <code>{typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'}/oauth/callback</code></li>
          <li>Google users sign in as <strong>viewers</strong> — they can see instances but not billing or API keys</li>
        </ol>
      </div>
    </div>
  );
}
