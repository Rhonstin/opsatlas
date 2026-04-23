'use client';
import { useState } from 'react';
import { api, DnsConnection } from '@/lib/api';
import styles from './dns.module.css';

interface Props {
  onClose: () => void;
  onCreated: (conn: DnsConnection) => void;
}

export default function AddDnsModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !token.trim()) {
      setError('Name and API token are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const conn = await api.createDnsConnection({
        provider: 'cloudflare',
        name: name.trim(),
        credentials: { token: token.trim() },
      });
      onCreated(conn);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Add DNS Connection</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalBody}>
          <div className={styles.field}>
            <label className={styles.label}>Provider</label>
            <div className={styles.providerFixed}>Cloudflare</div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              placeholder="e.g. My Cloudflare account"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>API Token</label>
            <input
              className={styles.input}
              type="password"
              placeholder="Cloudflare API token with DNS:Read permission"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className={styles.hint}>
              Create a token in Cloudflare Dashboard → My Profile → API Tokens.
              Required permissions: <strong>Zone → Zone → Read</strong> (to list zones)
              and <strong>Zone → DNS → Read</strong> (to list records).
              Set Zone Resources to <strong>All zones</strong>.
            </p>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <div className={styles.modalFooter}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Adding…' : 'Add connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
