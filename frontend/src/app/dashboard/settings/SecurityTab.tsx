'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import styles from './settings.module.css';

type MfaStep = 'idle' | 'setup' | 'verifying' | 'disabling';

export default function SecurityTab() {
  const { toast } = useToast();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<MfaStep>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [codeError, setCodeError] = useState('');

  useEffect(() => {
    api.getMfaStatus()
      .then((r) => setMfaEnabled(r.mfa_enabled))
      .catch(() => setMfaEnabled(false));
  }, []);

  async function handleSetup() {
    setWorking(true);
    setCodeError('');
    try {
      const res = await api.setupMfa();
      setSecret(res.secret);
      setQrDataUrl(res.qr_data_url);
      setCode('');
      setStep('setup');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setWorking(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setCodeError('');
    setWorking(true);
    try {
      await api.verifyMfaSetup(code);
      setMfaEnabled(true);
      setStep('idle');
      toast('success', 'Two-factor authentication enabled');
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setWorking(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setCodeError('');
    setWorking(true);
    try {
      await api.disableMfa(code);
      setMfaEnabled(false);
      setStep('idle');
      toast('success', 'Two-factor authentication disabled');
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setWorking(false);
    }
  }

  function cancelSetup() {
    setStep('idle');
    setCode('');
    setCodeError('');
    setQrDataUrl('');
    setSecret('');
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Security</div>
          <div className={styles.sectionDesc}>Two-factor authentication and account security settings</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
          Two-factor authentication
          {mfaEnabled !== null && (
            <span className={`badge ${mfaEnabled ? 'badge-active' : 'badge-pending'}`}>
              {mfaEnabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </div>
        <div className={styles.cardDesc}>
          Use an authenticator app (Google Authenticator, Authy, 1Password, etc.) to generate time-based one-time codes.
        </div>

        {step === 'idle' && mfaEnabled !== null && (
          <div style={{ marginTop: '1rem' }}>
            {mfaEnabled ? (
              <button className="btn-danger" style={{ fontSize: '0.8125rem' }} onClick={() => { setStep('disabling'); setCode(''); setCodeError(''); }}>
                Disable MFA
              </button>
            ) : (
              <button className="btn-primary" style={{ fontSize: '0.8125rem' }} onClick={handleSetup} disabled={working}>
                {working ? 'Setting up…' : 'Set up MFA'}
              </button>
            )}
          </div>
        )}

        {step === 'setup' && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.8125rem', color: 'var(--muted)' }}>
              Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.
            </div>
            {qrDataUrl && (
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <img src={qrDataUrl} alt="TOTP QR code" style={{ width: 180, height: 180, borderRadius: 8, background: '#fff', padding: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Or enter the key manually:</div>
                  <code style={{ fontSize: '0.8125rem', letterSpacing: '0.1em', padding: '0.375rem 0.625rem', background: 'var(--surface)', borderRadius: 6, userSelect: 'all', wordBreak: 'break-all', maxWidth: 280 }}>
                    {secret}
                  </code>
                </div>
              </div>
            )}
            <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 280 }}>
              <div className={styles.ssoField}>
                <label className={styles.ssoFieldLabel}>Authenticator code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.25rem' }}
                  autoComplete="one-time-code"
                />
              </div>
              {codeError && <div className={styles.error}>{codeError}</div>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn-ghost" onClick={cancelSetup}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={working || code.length !== 6}>
                  {working ? 'Verifying…' : 'Enable MFA'}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'disabling' && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.8125rem', color: 'var(--muted)' }}>
              Enter your current authenticator code to disable MFA.
            </div>
            <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 280 }}>
              <div className={styles.ssoField}>
                <label className={styles.ssoFieldLabel}>Authenticator code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.25rem' }}
                  autoComplete="one-time-code"
                />
              </div>
              {codeError && <div className={styles.error}>{codeError}</div>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn-ghost" onClick={() => { setStep('idle'); setCode(''); setCodeError(''); }}>Cancel</button>
                <button type="submit" className="btn-danger" disabled={working || code.length !== 6}>
                  {working ? 'Disabling…' : 'Disable MFA'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
