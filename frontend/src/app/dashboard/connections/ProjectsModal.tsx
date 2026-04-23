'use client';
import { useState, useEffect, FormEvent } from 'react';
import { api, GcpProject, SavedProject } from '@/lib/api';
import styles from './modal.module.css';
import pStyles from './projects.module.css';

interface Props {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}

export default function ProjectsModal({ connectionId, connectionName, onClose, onSaved }: Props) {
  const [discovered, setDiscovered] = useState<GcpProject[]>([]);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [manualId, setManualId] = useState('');

  // Load currently saved projects on open
  useEffect(() => {
    api.getSelectedProjects(connectionId).then((saved: SavedProject[]) => {
      setSavedProjects(saved);
      setSelected(new Set(saved.map((p) => p.external_id)));
      // Seed discovered list from saved so they show up without a Discover call
      setDiscovered(saved.map((p) => ({ projectId: p.external_id, name: p.name, state: 'ACTIVE' })));
    }).catch(() => {});
  }, [connectionId]);

  async function handleDiscover() {
    setDiscovering(true);
    setError('');
    try {
      const projects = await api.discoverProjects(connectionId);
      setDiscovered((prev) => {
        const existing = new Map(prev.map((p) => [p.projectId, p]));
        for (const p of projects) existing.set(p.projectId, p);
        return Array.from(existing.values());
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }

  function toggle(projectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return next;
    });
  }

  function addManual(e: FormEvent) {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    setDiscovered((prev) =>
      prev.find((p) => p.projectId === id)
        ? prev
        : [...prev, { projectId: id, name: id, state: 'ACTIVE' }],
    );
    setSelected((prev) => new Set([...prev, id]));
    setManualId('');
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const projects = Array.from(selected).map((id) => {
        const found = discovered.find((p) => p.projectId === id);
        return { projectId: id, name: found?.name ?? id };
      });
      await api.saveProjects(connectionId, projects);
      onSaved(projects.length);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function getSyncStatus(projectId: string): SavedProject | undefined {
    return savedProjects.find((s) => s.external_id === projectId);
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} style={{ maxWidth: 560 }}>
        <div className={styles.modalHeader}>
          <div>
            <h2>GCP Projects</h2>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{connectionName}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} type="button">✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Discover button */}
          <div className={pStyles.discoverRow}>
            <p className={pStyles.hint}>
              Click Discover to find projects this service account has access to, or add project IDs manually.
            </p>
            <button className="btn-ghost" onClick={handleDiscover} disabled={discovering} style={{ whiteSpace: 'nowrap' }}>
              {discovering ? 'Discovering…' : 'Discover'}
            </button>
          </div>

          {/* Project list */}
          {discovered.length > 0 && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} type="button"
                  onClick={() => setSelected(new Set(discovered.map((p) => p.projectId)))}>Select all</button>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} type="button"
                  onClick={() => setSelected(new Set())}>Deselect all</button>
              </div>
              <div className={pStyles.list}>
                {discovered.map((p) => {
                  const syncInfo = getSyncStatus(p.projectId);
                  return (
                    <label key={p.projectId} className={pStyles.item}>
                      <input type="checkbox" checked={selected.has(p.projectId)} onChange={() => toggle(p.projectId)} />
                      <div className={pStyles.itemInfo}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={pStyles.itemName}>{p.name}</span>
                          {syncInfo?.last_error && (
                            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Sync error</span>
                          )}
                          {syncInfo?.last_sync_at && !syncInfo.last_error && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              Synced {new Date(syncInfo.last_sync_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {p.name !== p.projectId && <span className={pStyles.itemId}>{p.projectId}</span>}
                        {syncInfo?.last_error && (
                          <span className={pStyles.itemId} style={{ color: '#ef4444' }}>{syncInfo.last_error}</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manual add */}
          <form onSubmit={addManual} className={pStyles.manualRow}>
            <input type="text" value={manualId} onChange={(e) => setManualId(e.target.value)}
              placeholder="Add project ID manually (e.g. my-project-123)" />
            <button type="submit" className="btn-ghost" style={{ whiteSpace: 'nowrap' }}>Add</button>
          </form>

          {error && <p className="error-msg">{error}</p>}

          <div className={pStyles.footer}>
            <span className={pStyles.count}>{selected.size} project{selected.size !== 1 ? 's' : ''} selected</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
