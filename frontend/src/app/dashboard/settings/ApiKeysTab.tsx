'use client';
import { useEffect, useState, useRef } from 'react';
import { api, ApiKey } from '@/lib/api';
import { useToast } from '@/lib/toast';
import styles from './settings.module.css';

export default function ApiKeysTab() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const keyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getApiKeys()
      .then(setKeys)
      .catch(() => toast('error', 'Failed to load API keys'))
      .finally(() => setLoading(false));
  }, [toast]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createApiKey(newKeyName.trim());
      setKeys((prev) => [{ id: res.id, name: res.name, key_prefix: res.key_prefix, created_at: res.created_at, last_used_at: null }, ...prev]);
      setCreatedKey(res.key);
      setNewKeyName('');
      toast('success', 'API key created');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete API key "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      toast('success', 'API key deleted');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete key');
    }
  }

  function copyKey() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      toast('success', 'Copied to clipboard');
    }
  }

  function dismissCreatedKey() {
    setCreatedKey(null);
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>API Keys</div>
          <div className={styles.sectionDesc}>
            Generate API keys for MCP clients and integrations. Keys are shown only once on creation.
          </div>
        </div>
      </div>

      {createdKey && (
        <div className={styles.card} style={{ borderColor: 'var(--success)', marginBottom: '1rem' }}>
          <div className={styles.cardTitle} style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>
            Key created successfully
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Copy this key now — it will not be shown again.
          </div>
          <div ref={keyRef} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{
              fontSize: '0.8125rem',
              padding: '8px 12px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
              wordBreak: 'break-all',
              flex: 1,
              userSelect: 'all',
            }}>
              {createdKey}
            </code>
            <button className="btn-primary" style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }} onClick={copyKey}>
              Copy
            </button>
            <button className="btn-ghost" style={{ fontSize: '0.8125rem' }} onClick={dismissCreatedKey}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className={styles.card}>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. Claude Desktop)"
            style={{ flex: 1 }}
            maxLength={100}
          />
          <button type="submit" className="btn-primary" disabled={creating || !newKeyName.trim()} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.8125rem' }}>Loading…</div>
        ) : keys.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', textAlign: 'center', padding: '24px 0' }}>
            No API keys yet. Create one above to connect MCP clients.
          </div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="th-btn" style={{ textAlign: 'left', padding: '8px 12px' }}>Name</th>
                  <th className="th-btn" style={{ textAlign: 'left', padding: '8px 12px' }}>Key prefix</th>
                  <th className="th-btn" style={{ textAlign: 'left', padding: '8px 12px' }}>Created</th>
                  <th className="th-btn" style={{ textAlign: 'left', padding: '8px 12px' }}>Last used</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontSize: '0.875rem' }}>{k.name}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <code style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>{k.key_prefix}…</code>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '0.8125rem', color: 'var(--muted)' }}>
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '0.8125rem', color: 'var(--muted)' }}>
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', color: 'var(--danger)' }}
                        onClick={() => handleDelete(k.id, k.name)}
                        title={`Delete ${k.name}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
