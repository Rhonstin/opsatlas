'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, Connection, DnsConnection, ConfigExport, ConfigImportResult } from '@/lib/api';
import { useSort } from '@/lib/useSort';
import { useToast } from '@/lib/toast';
import AddConnectionModal from '../connections/AddConnectionModal';
import EditConnectionModal from '../connections/EditConnectionModal';
import ProjectsModal from '../connections/ProjectsModal';
import AddDnsModal from '../dns/AddDnsModal';
import styles from './settings.module.css';
import connStyles from '../connections/connections.module.css';
import dnsStyles from '../dns/dns.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'connections' | 'dns' | 'billing' | 'sso' | 'config';

// ─── Connections Tab ──────────────────────────────────────────────────────────

function ConnectionsTab() {
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [projectsModal, setProjectsModal] = useState<Connection | null>(null);
  const [editModal, setEditModal] = useState<Connection | null>(null);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});

  type ConnSortKey = 'name' | 'provider' | 'status' | 'last_sync_at';
  const { sorted: sortedConns, toggle, indicator } = useSort<Connection & Record<string, unknown>, ConnSortKey>(
    connections as (Connection & Record<string, unknown>)[],
    'name',
  );

  async function fetchConnections() {
    try {
      const data = await api.getConnections();
      setConnections(data);
      const gcpConns = data.filter((c) => c.provider === 'gcp');
      const counts = await Promise.all(
        gcpConns.map((c) =>
          api.getSelectedProjects(c.id)
            .then((ps) => [c.id, ps.length] as [string, number])
            .catch(() => [c.id, 0] as [string, number]),
        ),
      );
      setProjectCounts(Object.fromEntries(counts));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchConnections(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this connection? This cannot be undone.')) return;
    try {
      await api.deleteConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      toast('info', 'Connection deleted');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: 'testing…' }));
    try {
      const res = await api.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: res.ok ? 'OK' : (res.error ?? 'failed') }));
      const updated = await api.getConnections();
      setConnections(updated);
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: 'failed' }));
    }
  }

  async function handleSync(id: string) {
    const connName = connections.find((c) => c.id === id)?.name ?? 'connection';
    setSyncing((prev) => ({ ...prev, [id]: true }));
    try {
      const { sync_run_id } = await api.triggerSync(id);
      const poll = setInterval(async () => {
        try {
          const run = await api.getSyncRun(sync_run_id);
          if (run.status !== 'running') {
            clearInterval(poll);
            setSyncing((prev) => ({ ...prev, [id]: false }));
            const updated = await api.getConnections();
            setConnections(updated);
            if (run.status === 'success') {
              toast('success', `Sync complete — ${connName}`);
            } else {
              toast('error', `Sync failed — ${run.error_log?.split('\n')[0] ?? connName}`);
            }
          }
        } catch {
          clearInterval(poll);
          setSyncing((prev) => ({ ...prev, [id]: false }));
        }
      }, 2000);
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Sync failed');
      setSyncing((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Cloud Connections</div>
          <div className={styles.sectionDesc}>GCP service accounts, AWS access keys, and Hetzner API tokens</div>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Add connection</button>
      </div>

      {loading && <p className={connStyles.empty}>Loading…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && connections.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔌</div>
          <h3>No connections yet</h3>
          <p>Add a GCP service account, Hetzner API token, or AWS access key to start syncing.</p>
        </div>
      )}

      {connections.length > 0 && (
        <div className={connStyles.tableWrap}>
          <div className={connStyles.table}>
            <div className={connStyles.tableHeader}>
              <button className={connStyles.thBtn} onClick={() => toggle('name')}>Name<span className={connStyles.indicator}>{indicator('name')}</span></button>
              <button className={connStyles.thBtn} onClick={() => toggle('provider')}>Provider<span className={connStyles.indicator}>{indicator('provider')}</span></button>
              <button className={connStyles.thBtn} onClick={() => toggle('status')}>Status<span className={connStyles.indicator}>{indicator('status')}</span></button>
              <span>Projects</span>
              <button className={connStyles.thBtn} onClick={() => toggle('last_sync_at')}>Last sync<span className={connStyles.indicator}>{indicator('last_sync_at')}</span></button>
              <span></span>
            </div>
            {sortedConns.map((conn) => (
              <div key={conn.id} className={connStyles.row}>
                <span className={connStyles.name}>{conn.name}</span>
                <span className={connStyles.provider}>{conn.provider.toUpperCase()}</span>
                <span><span className={`badge badge-${conn.status}`}>{conn.status}</span></span>
                <span>
                  {conn.provider === 'gcp' ? (
                    <button className={connStyles.projectsBtn} onClick={() => setProjectsModal(conn)}>
                      {projectCounts[conn.id] != null
                        ? `${projectCounts[conn.id]} project${projectCounts[conn.id] !== 1 ? 's' : ''}`
                        : '—'}
                    </button>
                  ) : <span className={connStyles.muted}>—</span>}
                </span>
                <span className={connStyles.muted}>
                  {conn.last_sync_at ? new Date(conn.last_sync_at).toLocaleString() : 'Never'}
                </span>
                <span className={connStyles.actions}>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setEditModal(conn)}>Edit</button>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleTest(conn.id)}>
                    {testResults[conn.id] ?? 'Test'}
                  </button>
                  {['gcp', 'hetzner', 'aws'].includes(conn.provider) && (
                    <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleSync(conn.id)} disabled={syncing[conn.id]}>
                      {syncing[conn.id] ? 'Syncing…' : 'Sync'}
                    </button>
                  )}
                  <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleDelete(conn.id)}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && <AddConnectionModal onClose={() => setShowModal(false)} onCreated={(conn) => { setConnections((prev) => [conn, ...prev]); setShowModal(false); }} />}
      {editModal && (
        <EditConnectionModal
          connection={editModal}
          onClose={() => setEditModal(null)}
          onUpdated={(updated) => {
            setConnections((prev) => prev.map((c) => c.id === updated.id ? updated : c));
            setEditModal(null);
            toast('success', `Connection updated — ${updated.name}`);
          }}
        />
      )}
      {projectsModal && (
        <ProjectsModal
          connectionId={projectsModal.id}
          connectionName={projectsModal.name}
          onClose={() => setProjectsModal(null)}
          onSaved={(count) => {
            setProjectCounts((prev) => ({ ...prev, [projectsModal.id]: count }));
            setProjectsModal(null);
          }}
        />
      )}
    </section>
  );
}

// ─── DNS Tab ──────────────────────────────────────────────────────────────────

const DNS_STATUS_BADGE: Record<string, string> = {
  active: 'badge-active',
  error: 'badge-error',
  pending: 'badge-pending',
};

function DnsTab() {
  const { toast } = useToast();
  const [connections, setConnections] = useState<DnsConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  async function fetchConnections() {
    try {
      const data = await api.getDnsConnections();
      setConnections(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load DNS connections');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchConnections(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this DNS connection? All synced records will be removed.')) return;
    try {
      await api.deleteDnsConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      toast('info', 'DNS connection deleted');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: 'testing…' }));
    try {
      const res = await api.testDnsConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: res.ok ? 'OK' : (res.error ?? 'failed') }));
      const updated = await api.getDnsConnections();
      setConnections(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'failed';
      setTestResults((prev) => ({ ...prev, [id]: msg }));
    }
  }

  async function handleSync(id: string) {
    setSyncing((prev) => ({ ...prev, [id]: true }));
    try {
      await api.triggerDnsSync(id);
      const poll = setInterval(async () => {
        try {
          const updated = await api.getDnsConnections();
          const conn = updated.find((c) => c.id === id);
          if (conn && conn.status !== 'pending') {
            clearInterval(poll);
            setSyncing((prev) => ({ ...prev, [id]: false }));
            setConnections(updated);
            if (conn.status === 'active') toast('success', `DNS sync complete — ${conn.name}`);
            else if (conn.status === 'error') toast('error', `DNS sync failed — ${conn.last_error?.split('\n')[0] ?? conn.name}`);
          }
        } catch {
          clearInterval(poll);
          setSyncing((prev) => ({ ...prev, [id]: false }));
        }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setSyncing((prev) => ({ ...prev, [id]: false })); fetchConnections(); }, 60_000);
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'DNS sync failed');
      setSyncing((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>DNS Connections</div>
          <div className={styles.sectionDesc}>
            Cloudflare and other DNS providers — sync records to map domains to instances.{' '}
            <Link href="/dashboard/dns/records" className={styles.inlineLink}>View records →</Link>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Add connection</button>
      </div>

      {loading && <p className={dnsStyles.empty}>Loading…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && connections.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🌐</div>
          <h3>No DNS connections yet</h3>
          <p>Add a Cloudflare API token to sync DNS records and map domains to your instances.</p>
        </div>
      )}

      {connections.length > 0 && (
        <div className={dnsStyles.table}>
          <div className={dnsStyles.tableHeader}>
            <span>Name</span>
            <span>Provider</span>
            <span>Status</span>
            <span>Last sync</span>
            <span></span>
          </div>
          {connections.map((conn) => (
            <div key={conn.id} className={dnsStyles.row}>
              <div>
                <div className={dnsStyles.connName}>{conn.name}</div>
                {conn.last_error && <div className={dnsStyles.connError}>{conn.last_error}</div>}
              </div>
              <span className={dnsStyles.provider}>{conn.provider.toUpperCase()}</span>
              <span><span className={`badge ${DNS_STATUS_BADGE[conn.status] ?? 'badge-pending'}`}>{conn.status}</span></span>
              <span className={dnsStyles.muted}>{conn.last_sync_at ? new Date(conn.last_sync_at).toLocaleString() : 'Never'}</span>
              <span className={dnsStyles.actions}>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleTest(conn.id)}>
                  {testResults[conn.id] ?? 'Test'}
                </button>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleSync(conn.id)} disabled={syncing[conn.id]}>
                  {syncing[conn.id] ? 'Syncing…' : 'Sync'}
                </button>
                <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleDelete(conn.id)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {showModal && <AddDnsModal onClose={() => setShowModal(false)} onCreated={(conn) => { setConnections((prev) => [conn, ...prev]); setShowModal(false); }} />}
    </section>
  );
}

// ─── Billing Tab ──────────────────────────────────────────────────────────────

function BillingTab() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');

  useEffect(() => {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedPeriod(current);
    api.getBillingPeriods()
      .then(setPeriods)
      .catch(() => { /* non-fatal */ });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await api.refreshBilling(selectedPeriod || undefined);
      const total = res.results?.length ?? 0;
      const errors = res.results?.filter((r) => r.status === 'error').length ?? 0;
      if (errors === 0) {
        toast('success', `Billing fetched — ${total} provider${total !== 1 ? 's' : ''}`);
      } else {
        toast('error', `${errors} provider${errors !== 1 ? 's' : ''} failed — check connections`);
      }
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Billing</div>
          <div className={styles.sectionDesc}>
            Fetch actual cost data from your cloud providers for a billing period.{' '}
            <Link href="/dashboard/billing" className={styles.inlineLink}>View actuals →</Link>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Fetch actuals</div>
            <div className={styles.cardDesc}>
              Pull real billing data from GCP (Cloud Billing API), AWS (Cost Explorer), and Hetzner.
              Run this once per month or enable auto-fetch via an Auto-Update policy.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              style={{ width: 130 }}
            >
              {periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              {!periods.includes(selectedPeriod) && selectedPeriod && (
                <option value={selectedPeriod}>{selectedPeriod}</option>
              )}
            </select>
            <button className="btn-primary" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Fetching…' : 'Fetch actuals'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Auto-fetch</div>
        <div className={styles.cardDesc} style={{ marginTop: 6 }}>
          Enable <strong>Sync cost</strong> in an{' '}
          <Link href="/dashboard/auto-update" className={styles.inlineLink}>Auto-Update policy</Link>{' '}
          to fetch billing data automatically on each sync cycle.
        </div>
      </div>
    </section>
  );
}

// ─── SSO Tab ──────────────────────────────────────────────────────────────────

function SsoTab() {
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
    const redirectUri = `${window.location.origin}/auth/callback`;
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
            <li>Set the redirect URI to <code>{typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'}/auth/callback</code></li>
            <li>Enable scopes: <code>openid email profile</code></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [allowRegistrations, setAllowRegistrations] = useState<boolean | null>(null);
  const [togglingReg, setTogglingReg] = useState(false);

  useEffect(() => {
    api.getServerConfig()
      .then((cfg) => setAllowRegistrations(cfg.allowRegistrations ?? true))
      .catch(() => setAllowRegistrations(true));
  }, []);

  async function handleToggleRegistrations() {
    if (allowRegistrations === null) return;
    const next = !allowRegistrations;
    setTogglingReg(true);
    try {
      await api.setAllowRegistrations(next);
      setAllowRegistrations(next);
      toast('success', next ? 'Registrations enabled' : 'Registrations disabled');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Failed to update setting');
    } finally {
      setTogglingReg(false);
    }
  }
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ConfigImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opsatlas-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: ConfigExport;
      try { parsed = JSON.parse(text) as ConfigExport; } catch { throw new Error('Invalid JSON file'); }
      if (!parsed.version || !Array.isArray(parsed.cloud_connections)) throw new Error('Not a valid opsatlas config file');
      const result = await api.importConfig(parsed);
      setImportResult(result);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const typeLabel = (type: string) => {
    if (type === 'cloud_connection') return 'Cloud connection';
    if (type === 'dns_connection') return 'DNS connection';
    if (type === 'auto_update_policy') return 'Auto-update policy';
    return type;
  };

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Configuration</div>
          <div className={styles.sectionDesc}>Export or import all connections and policies as JSON</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>New registrations</div>
            <div className={styles.cardDesc}>
              Allow new users to sign up with email and password. Disable this once your team is set up.
            </div>
          </div>
          <button
            className={allowRegistrations ? 'btn-danger' : 'btn-primary'}
            style={{ fontSize: 13, flexShrink: 0 }}
            onClick={handleToggleRegistrations}
            disabled={togglingReg || allowRegistrations === null}
          >
            {togglingReg ? 'Saving…' : allowRegistrations ? 'Disable' : 'Enable'}
          </button>
        </div>
        {allowRegistrations !== null && (
          <div style={{ marginTop: 10, fontSize: 13, color: allowRegistrations ? '#22c55e' : 'var(--muted)' }}>
            {allowRegistrations ? 'Registrations are open' : 'Registrations are closed — SSO or invite only'}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Export</div>
            <div className={styles.cardDesc}>
              Download all cloud connections, DNS connections, and auto-update policies.
              <span className={styles.warning}> Credentials included in plaintext — keep secure.</span>
            </div>
          </div>
          <button className="btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Import</div>
            <div className={styles.cardDesc}>
              Restore connections and policies from a previously exported file.
              Existing items (matched by provider + name) are skipped.
            </div>
          </div>
          <div>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFileChange} />
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import file'}
            </button>
          </div>
        </div>
        {importError && <div className={styles.error}>{importError}</div>}
        {importResult && (
          <div className={styles.resultBox}>
            <div className={styles.resultSummary}>
              <span className={styles.created}>{importResult.created} created</span>
              <span className={styles.skipped}>{importResult.skipped} skipped</span>
            </div>
            <div className={styles.resultList}>
              {importResult.results.map((r, i) => (
                <div key={i} className={styles.resultRow}>
                  <span className={`${styles.dot} ${r.status === 'created' ? styles.dotCreated : styles.dotSkipped}`} />
                  <span className={styles.resultType}>{typeLabel(r.type)}</span>
                  <span className={styles.resultName}>{r.name}</span>
                  <span className={styles.resultStatus}>{r.status === 'created' ? 'created' : `skipped${r.reason ? ` — ${r.reason}` : ''}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'dns', label: 'DNS' },
  { id: 'billing', label: 'Billing' },
  { id: 'sso', label: 'SSO' },
  { id: 'config', label: 'Config' },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get('tab') ?? 'connections';
  const tab = (TABS.some((t) => t.id === raw) ? raw : 'connections') as Tab;

  function setTab(t: Tab) {
    router.push(`/dashboard/settings?tab=${t}`, { scroll: false });
  }

  return (
    <div>
      <h1 className={styles.heading}>Settings</h1>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'dns' && <DnsTab />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'sso' && <SsoTab />}
        {tab === 'config' && <ConfigTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--muted)', padding: 20 }}>Loading…</p>}>
      <SettingsContent />
    </Suspense>
  );
}
