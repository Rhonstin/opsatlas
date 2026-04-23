'use client';
import { useState, FormEvent } from 'react';
import { api, Connection } from '@/lib/api';
import styles from './modal.module.css';

interface Props {
  connection: Connection;
  onClose: () => void;
  onUpdated: (conn: Connection) => void;
}

export default function EditConnectionModal({ connection, onClose, onUpdated }: Props) {
  const [name, setName] = useState(connection.name);
  const [credentialsRaw, setCredentialsRaw] = useState('');
  const [awsKeyId, setAwsKeyId] = useState('');
  const [awsSecret, setAwsSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const updates: { name?: string; credentials?: unknown } = {};

    if (name !== connection.name) updates.name = name;

    if (connection.provider === 'aws') {
      if (awsKeyId.trim() || awsSecret.trim()) {
        if (!awsKeyId.trim() || !awsSecret.trim()) {
          setError('Both Access Key ID and Secret Access Key are required');
          return;
        }
        updates.credentials = { access_key_id: awsKeyId.trim(), secret_access_key: awsSecret.trim() };
      }
    } else if (credentialsRaw.trim()) {
      if (connection.provider === 'hetzner') {
        updates.credentials = { token: credentialsRaw.trim() };
      } else {
        try {
          updates.credentials = JSON.parse(credentialsRaw);
        } catch {
          setError('Credentials must be valid JSON');
          return;
        }
      }
    }

    if (!updates.name && !updates.credentials) {
      onClose();
      return;
    }

    setLoading(true);
    try {
      const conn = await api.updateConnection(connection.id, updates);
      onUpdated(conn);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Edit connection</h2>
          <button className={styles.closeBtn} onClick={onClose} type="button">✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label>Provider</label>
            <input type="text" value={connection.provider.toUpperCase()} disabled />
          </div>

          <div className={styles.field}>
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {connection.provider === 'aws' ? (
            <>
              <div className={styles.field}>
                <label>Access Key ID</label>
                <input
                  type="text"
                  value={awsKeyId}
                  onChange={(e) => setAwsKeyId(e.target.value)}
                  placeholder="Leave blank to keep existing"
                  spellCheck={false}
                />
              </div>
              <div className={styles.field}>
                <label>Secret Access Key</label>
                <input
                  type="password"
                  value={awsSecret}
                  onChange={(e) => setAwsSecret(e.target.value)}
                  placeholder="Leave blank to keep existing"
                  spellCheck={false}
                />
                <span className={styles.hint}>Leave both blank to keep existing credentials.</span>
              </div>
            </>
          ) : (
            <div className={styles.field}>
              <label>{connection.provider === 'hetzner' ? 'New API Token' : 'New Credentials (JSON)'}</label>
              <textarea
                rows={connection.provider === 'hetzner' ? 3 : 10}
                value={credentialsRaw}
                onChange={(e) => setCredentialsRaw(e.target.value)}
                placeholder={
                  connection.provider === 'hetzner'
                    ? 'Paste your Hetzner API token here'
                    : '{\n  "type": "service_account",\n  "project_id": "my-project",\n  ...\n}'
                }
                className={styles.textarea}
                spellCheck={false}
              />
              <span className={styles.hint}>
                Leave blank to keep existing credentials.
                {connection.provider === 'gcp' && ' Paste updated service account key JSON to replace.'}
                {connection.provider === 'hetzner' && ' Paste a new API token to replace the existing one.'}
              </span>
            </div>
          )}

          {error && <p className="error-msg">{error}</p>}

          <div className={styles.footer}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
