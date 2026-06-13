'use client';
import { useEffect, useState } from 'react';
import { api, Connection } from '@/lib/api';
import { useSort } from '@/lib/useSort';
import { useToast } from '@/lib/toast';
import { usePollUntil } from '@/lib/usePollUntil';
import AddConnectionModal from '../connections/AddConnectionModal';
import EditConnectionModal from '../connections/EditConnectionModal';
import ProjectsModal from '../connections/ProjectsModal';
import styles from './settings.module.css';
import connStyles from '../connections/connections.module.css';

export default function ConnectionsTab() {
  const { toast } = useToast();
  const poll = usePollUntil(2000);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [projectsModal, setProjectsModal] = useState<Connection | null>(null);
  const [editModal, setEditModal] = useState<Connection | null>(null);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});
  const [projectStatus, setProjectStatus] = useState<Record<string, { ok: number; errored: number; errors: string[] }>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  type ConnSortKey = 'name' | 'provider' | 'status' | 'last_sync_at';
  const { sorted: sortedConns, toggle, indicator } = useSort<Connection & Record<string, unknown>, ConnSortKey>(
    connections as (Connection & Record<string, unknown>)[],
    'name',
  );

  async function fetchConnections() {
    try {
      const data = await api.getConnections();
      setConnections(data);
      const projectConns = data.filter((c) => c.provider === 'gcp' || c.provider === 'coolify');
      const results = await Promise.all(
        projectConns.map(async (c) => {
          try {
            const ps = await api.getSelectedProjects(c.id);
            const ok = ps.filter((p) => !p.last_error).length;
            const errored = ps.filter((p) => !!p.last_error).length;
            const errors = ps.filter((p): p is typeof p & { last_error: string } => !!p.last_error).map((p) => `${p.name}: ${p.last_error}`);
            return { id: c.id, count: ps.length, ok, errored, errors };
          } catch {
            return { id: c.id, count: 0, ok: 0, errored: 0, errors: [] };
          }
        }),
      );
      const counts: Record<string, number> = {};
      const status: Record<string, { ok: number; errored: number; errors: string[] }> = {};
      for (const r of results) {
        counts[r.id] = r.count;
        status[r.id] = { ok: r.ok, errored: r.errored, errors: r.errors };
      }
      setProjectCounts(counts);
      setProjectStatus(status);
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
      poll(async () => {
        try {
          const run = await api.getSyncRun(sync_run_id);
          if (run.status === 'running') return false;
          setSyncing((prev) => ({ ...prev, [id]: false }));
          const updated = await api.getConnections();
          setConnections(updated);
          if (run.status === 'success') {
            toast('success', `Sync complete — ${connName}`);
          } else {
            toast('error', `Sync failed — ${run.error_log?.split('\n')[0] ?? connName}`);
          }
          return true;
        } catch {
          setSyncing((prev) => ({ ...prev, [id]: false }));
          return true;
        }
      });
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
                <span>                <span>
                  <span className={`badge badge-${conn.status}`}>{conn.status}</span>
                  {projectStatus[conn.id]?.errored > 0 && conn.status === 'active' && (
                    <span className="badge badge-warning" style={{ marginLeft: 4 }}>partial</span>
                  )}
                </span></span>
                <span>
                  {conn.provider === 'gcp' ? (
                    <span>
                      <button className={connStyles.projectsBtn} onClick={() => setProjectsModal(conn)}>
                        {projectCounts[conn.id] != null
                          ? `${projectStatus[conn.id]?.ok ?? 0}/${projectCounts[conn.id]} synced`
                          : '—'}
                      </button>
                      {projectStatus[conn.id]?.errored > 0 && (
                        <button
                          className={connStyles.projectsBtn}
                          style={{ color: 'var(--error-color, #e53e3e)', marginLeft: 4, fontSize: 11 }}
                          onClick={() => setExpandedProjects((prev) => ({ ...prev, [conn.id]: !prev[conn.id] }))}
                          title={projectStatus[conn.id]?.errors.join('\n')}
                        >
                          {projectStatus[conn.id]?.errored} failed
                        </button>
                      )}
                      {expandedProjects[conn.id] && projectStatus[conn.id]?.errors.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--error-color, #e53e3e)', marginTop: 2 }}>
                          {projectStatus[conn.id].errors.map((e, i) => (
                            <div key={i} title={e}>• {e.split(':')[0]}</div>
                          ))}
                        </div>
                      )}
                    </span>
                  ) : conn.provider === 'coolify' ? (
                    <span className={connStyles.muted}>
                      {projectCounts[conn.id] != null
                        ? `${projectCounts[conn.id]} project${projectCounts[conn.id] !== 1 ? 's' : ''}`
                        : '—'}
                    </span>
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
                  {['gcp', 'hetzner', 'aws', 'coolify'].includes(conn.provider) && (
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
