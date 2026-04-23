'use client';
import { useState, FormEvent } from 'react';
import { api, Connection, GcpProject } from '@/lib/api';
import styles from './modal.module.css';
import wStyles from './wizard.module.css';

interface Props {
  onClose: () => void;
  onCreated: (conn: Connection) => void;
}

type Provider = 'gcp' | 'aws' | 'hetzner';
type Step = 1 | 2 | 3;

const PROVIDERS: { id: Provider; label: string; description: string; icon: string }[] = [
  { id: 'gcp', label: 'Google Cloud', description: 'Service account JSON key', icon: '☁' },
  { id: 'aws', label: 'Amazon Web Services', description: 'IAM access key & secret', icon: '▲' },
  { id: 'hetzner', label: 'Hetzner Cloud', description: 'API read/write token', icon: '⬡' },
];

export default function AddConnectionModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [provider, setProvider] = useState<Provider>('gcp');

  // Step 2 state
  const [name, setName] = useState('');
  const [credentialsRaw, setCredentialsRaw] = useState('');
  const [awsKeyId, setAwsKeyId] = useState('');
  const [awsSecret, setAwsSecret] = useState('');
  const [hetznerToken, setHetznerToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Step 3 (GCP projects) state
  const [createdConn, setCreatedConn] = useState<Connection | null>(null);
  const [discovered, setDiscovered] = useState<GcpProject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [manualId, setManualId] = useState('');
  const [savingProjects, setSavingProjects] = useState(false);

  // ── Step 1 ───────────────────────────────────────────────────────────────────

  function pickProvider(p: Provider) {
    setProvider(p);
    setTestResult(null);
    setError('');
    setStep(2);
  }

  // ── Step 2 ───────────────────────────────────────────────────────────────────

  function getCredentials(): unknown | null {
    if (provider === 'aws') return { access_key_id: awsKeyId.trim(), secret_access_key: awsSecret.trim() };
    if (provider === 'hetzner') return { token: hetznerToken.trim() };
    try { return JSON.parse(credentialsRaw); } catch { return null; }
  }

  async function handleTest() {
    setError('');
    const creds = getCredentials();
    if (!creds) { setError('Credentials must be valid JSON'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.validateCredentials(provider, creds);
      setTestResult({ ok: res.ok, message: res.message ?? res.error ?? '' });
    } catch (err: unknown) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    const creds = getCredentials();
    if (!creds) { setError('Credentials must be valid JSON'); return; }
    setError('');
    setCreating(true);
    try {
      const conn = await api.createConnection({ provider, name: name.trim(), credentials: creds });
      setCreatedConn(conn);
      if (provider === 'gcp') {
        setStep(3);
      } else {
        onCreated(conn);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create connection');
    } finally {
      setCreating(false);
    }
  }

  // ── Step 3 ───────────────────────────────────────────────────────────────────

  async function handleDiscover() {
    if (!createdConn) return;
    setDiscovering(true);
    setDiscoverError('');
    try {
      const projects = await api.discoverProjects(createdConn.id);
      setDiscovered((prev) => {
        const existing = new Map(prev.map((p) => [p.projectId, p]));
        for (const p of projects) existing.set(p.projectId, p);
        return Array.from(existing.values());
      });
    } catch (err: unknown) {
      setDiscoverError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }

  function toggleProject(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addManual(e: FormEvent) {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    setDiscovered((prev) =>
      prev.find((p) => p.projectId === id) ? prev : [...prev, { projectId: id, name: id, state: 'ACTIVE' }],
    );
    setSelected((prev) => new Set([...prev, id]));
    setManualId('');
  }

  function finishWithConn() {
    if (createdConn) { onCreated(createdConn); onClose(); }
  }

  async function handleFinish() {
    if (!createdConn) return;
    setSavingProjects(true);
    try {
      if (selected.size > 0) {
        const projects = Array.from(selected).map((id) => {
          const found = discovered.find((p) => p.projectId === id);
          return { projectId: id, name: found?.name ?? id };
        });
        await api.saveProjects(createdConn.id, projects);
      }
    } catch { /* non-fatal */ } finally {
      setSavingProjects(false);
      finishWithConn();
    }
  }

  const gcpPlaceholder = '{\n  "type": "service_account",\n  "project_id": "my-project",\n  "private_key_id": "...",\n  ...\n}';
  const totalSteps = provider === 'gcp' ? 3 : 2;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} style={{ maxWidth: step === 1 ? 560 : 520 }}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step > 1 && (
              <button
                className={styles.closeBtn}
                type="button"
                onClick={() => { setStep((step - 1) as Step); setError(''); setTestResult(null); }}
                title="Back"
                style={{ fontSize: 18 }}
              >
                ←
              </button>
            )}
            <h2>
              {step === 1 && 'Add connection'}
              {step === 2 && PROVIDERS.find(p => p.id === provider)?.label}
              {step === 3 && 'GCP Projects'}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={wStyles.dots}>
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                <span
                  key={s}
                  className={step === s ? wStyles.dotActive : step > s ? wStyles.dotDone : wStyles.dot}
                />
              ))}
            </div>
            <button className={styles.closeBtn} onClick={onClose} type="button">✕</button>
          </div>
        </div>

        {/* ── Step 1: Provider picker ── */}
        {step === 1 && (
          <div className={wStyles.providerGrid}>
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" className={wStyles.providerCard} onClick={() => pickProvider(p.id)}>
                <span className={wStyles.providerIcon}>{p.icon}</span>
                <span className={wStyles.providerLabel}>{p.label}</span>
                <span className={wStyles.providerDesc}>{p.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 2: Credentials ── */}
        {step === 2 && (
          <form onSubmit={handleCreate} className={styles.form}>
            <div className={styles.field}>
              <label>Connection name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={provider === 'gcp' ? 'My GCP Project' : provider === 'hetzner' ? 'My Hetzner Project' : 'My AWS Account'}
                required
                autoFocus
              />
            </div>

            {provider === 'aws' && (
              <>
                <div className={styles.field}>
                  <label>Access Key ID</label>
                  <input type="text" value={awsKeyId} onChange={(e) => setAwsKeyId(e.target.value)}
                    placeholder="AKIAIOSFODNN7EXAMPLE" required spellCheck={false} />
                </div>
                <div className={styles.field}>
                  <label>Secret Access Key</label>
                  <input type="password" value={awsSecret} onChange={(e) => setAwsSecret(e.target.value)}
                    placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" required spellCheck={false} />
                  <span className={styles.hint}>All enabled regions are synced automatically.</span>
                </div>
              </>
            )}

            {provider === 'hetzner' && (
              <div className={styles.field}>
                <label>API Token</label>
                <textarea rows={3} value={hetznerToken} onChange={(e) => setHetznerToken(e.target.value)}
                  placeholder="Paste your Hetzner API token here" required className={styles.textarea} spellCheck={false} />
                <span className={styles.hint}>Read &amp; Write token — Hetzner Cloud Console → Security → API Tokens</span>
              </div>
            )}

            {provider === 'gcp' && (
              <div className={styles.field}>
                <label>Service Account Key (JSON)</label>
                <textarea rows={9} value={credentialsRaw} onChange={(e) => setCredentialsRaw(e.target.value)}
                  placeholder={gcpPlaceholder} required className={styles.textarea} spellCheck={false} />
                <span className={styles.hint}>Paste your GCP service account key JSON</span>
              </div>
            )}

            {testResult && (
              <div className={testResult.ok ? wStyles.testOk : wStyles.testError}>
                {testResult.ok ? '✓' : '✗'} {testResult.message}
              </div>
            )}

            {error && <p className="error-msg">{error}</p>}

            <div className={wStyles.stepFooter}>
              <button type="button" className="btn-ghost" onClick={handleTest} disabled={testing}>
                {testing ? 'Testing…' : 'Test credentials'}
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : provider === 'gcp' ? 'Next →' : 'Add connection'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── Step 3: GCP Projects ── */}
        {step === 3 && (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className={wStyles.stepHint}>
              Choose which projects to sync. You can change this anytime from the connections list.
            </p>

            <div className={wStyles.discoverRow}>
              <button className="btn-ghost" onClick={handleDiscover} disabled={discovering}>
                {discovering ? 'Discovering…' : 'Discover projects'}
              </button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                or add project IDs manually below
              </span>
            </div>

            {discovered.length > 0 && (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} type="button"
                    onClick={() => setSelected(new Set(discovered.map(p => p.projectId)))}>Select all</button>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} type="button"
                    onClick={() => setSelected(new Set())}>Deselect all</button>
                </div>
                <div className={wStyles.projectList}>
                  {discovered.map((p) => (
                    <label key={p.projectId} className={wStyles.projectItem}>
                      <input type="checkbox" checked={selected.has(p.projectId)} onChange={() => toggleProject(p.projectId)} />
                      <div>
                        <span className={wStyles.projectName}>{p.name}</span>
                        {p.name !== p.projectId && <span className={wStyles.projectId}>{p.projectId}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={addManual} className={wStyles.manualRow}>
              <input type="text" value={manualId} onChange={(e) => setManualId(e.target.value)}
                placeholder="project-id-123" />
              <button type="submit" className="btn-ghost" style={{ whiteSpace: 'nowrap' }}>Add</button>
            </form>

            {discoverError && <p className="error-msg">{discoverError}</p>}

            <div className={wStyles.stepFooter}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {selected.size} project{selected.size !== 1 ? 's' : ''} selected
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-ghost" type="button" onClick={finishWithConn}>Skip</button>
                <button className="btn-primary" type="button" onClick={handleFinish} disabled={savingProjects}>
                  {savingProjects ? 'Saving…' : 'Finish'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
