'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, DnsConnection } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { usePollUntil } from '@/lib/usePollUntil';
import AddDnsModal from '../dns/AddDnsModal';
import styles from './settings.module.css';
import dnsStyles from '../dns/dns.module.css';

const DNS_STATUS_BADGE: Record<string, string> = {
  active: 'badge-active',
  error: 'badge-error',
  pending: 'badge-pending',
};

export default function DnsTab() {
  const { toast } = useToast();
  const poll = usePollUntil(2000);
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
      poll(async () => {
        try {
          const updated = await api.getDnsConnections();
          const conn = updated.find((c) => c.id === id);
          if (!conn || conn.status === 'pending') return false;
          setSyncing((prev) => ({ ...prev, [id]: false }));
          setConnections(updated);
          if (conn.status === 'active') toast('success', `DNS sync complete — ${conn.name}`);
          else if (conn.status === 'error') toast('error', `DNS sync failed — ${conn.last_error?.split('\n')[0] ?? conn.name}`);
          return true;
        } catch {
          setSyncing((prev) => ({ ...prev, [id]: false }));
          return true;
        }
      }, {
        timeoutMs: 60_000,
        onTimeout: () => { setSyncing((prev) => ({ ...prev, [id]: false })); fetchConnections(); },
      });
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
