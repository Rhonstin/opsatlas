'use client';
import { useEffect, useState } from 'react';
import { api, AutoUpdatePolicy, AutoUpdateRun } from '@/lib/api';
import styles from './auto-update.module.css';

const INTERVALS = [
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '24 hours', value: 1440 },
];

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function intervalLabel(minutes: number): string {
  const match = INTERVALS.find((i) => i.value === minutes);
  if (match) return match.label;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60}h`;
  return `${minutes / 1440}d`;
}

function statusClass(s: string | null): string {
  if (s === 'success') return styles.statusSuccess;
  if (s === 'error') return styles.statusError;
  if (s === 'running') return styles.statusRunning;
  return '';
}

// ── Add Policy Form ────────────────────────────────────────────────────────────

function AddPolicyForm({ onCreated, onCancel }: { onCreated: (p: AutoUpdatePolicy) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [syncInstances, setSyncInstances] = useState(true);
  const [syncDns, setSyncDns] = useState(false);
  const [syncCost, setSyncCost] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const policy = await api.createAutoUpdatePolicy({
        name: name.trim(),
        interval_minutes: intervalMinutes,
        sync_instances: syncInstances,
        sync_dns: syncDns,
        sync_cost: syncCost,
        enabled: true,
      });
      onCreated(policy);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formTitle}>New Auto-Update Policy</div>

      <div className={styles.formRow}>
        <div className={styles.formField} style={{ flex: 1 }}>
          <label className={styles.formLabel}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hourly GCP refresh"
            style={{ width: '100%' }}
          />
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Interval</label>
          <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className={styles.formLabel} style={{ marginBottom: 8 }}>Refresh</div>
        <div className={styles.checkRow}>
          <label className={styles.checkItem}>
            <input type="checkbox" checked={syncInstances} onChange={(e) => setSyncInstances(e.target.checked)} />
            Instances
          </label>
          <label className={styles.checkItem}>
            <input type="checkbox" checked={syncDns} onChange={(e) => setSyncDns(e.target.checked)} />
            DNS records
          </label>
          <label className={styles.checkItem}>
            <input type="checkbox" checked={syncCost} onChange={(e) => setSyncCost(e.target.checked)} />
            Cost data
          </label>
        </div>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.formActions}>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Creating…' : 'Create policy'}
        </button>
      </div>
    </form>
  );
}

// ── Run History ───────────────────────────────────────────────────────────────

function RunHistory({ policyId }: { policyId: string }) {
  const [runs, setRuns] = useState<AutoUpdateRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAutoUpdateRuns(policyId)
      .then(setRuns)
      .finally(() => setLoading(false));
  }, [policyId]);

  if (loading) return <p className={styles.cardStatus}>Loading history…</p>;
  if (runs.length === 0) return <p className={styles.cardStatus} style={{ marginTop: 8 }}>No runs yet.</p>;

  return (
    <div className={styles.runHistory}>
      {runs.map((run) => {
        const duration = run.finished_at
          ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
          : null;
        return (
          <div key={run.id} className={styles.runRow}>
            <span className={`${styles.runDot} ${run.status === 'success' ? styles.runDotSuccess : run.status === 'error' ? styles.runDotError : styles.runDotRunning}`} />
            <span className={styles.runDate}>{fmtDate(run.started_at)}</span>
            {run.status === 'success' && (
              <span className={styles.runMeta}>
                {run.connections_synced} connection{run.connections_synced !== 1 ? 's' : ''}
                {duration !== null ? ` · ${duration}s` : ''}
              </span>
            )}
            {run.status === 'error' && (
              <span className={styles.runError}>{run.error}</span>
            )}
            {run.status === 'running' && (
              <span className={styles.runMeta}>running…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Policy Card ────────────────────────────────────────────────────────────────

function PolicyCard({
  policy,
  onChange,
  onDelete,
}: {
  policy: AutoUpdatePolicy;
  onChange: (updated: AutoUpdatePolicy) => void;
  onDelete: (id: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function toggleEnabled() {
    const updated = await api.updateAutoUpdatePolicy(policy.id, { enabled: !policy.enabled });
    onChange(updated);
  }

  async function runNow() {
    setRunning(true);
    try {
      await api.runAutoUpdatePolicy(policy.id);
      onChange({ ...policy, next_run_at: new Date(Date.now() + 60_000).toISOString() });
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete policy "${policy.name}"?`)) return;
    await api.deleteAutoUpdatePolicy(policy.id);
    onDelete(policy.id);
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardMain}>
        <div className={styles.cardName}>{policy.name}</div>
        <div className={styles.cardMeta}>
          <span>Every {intervalLabel(policy.interval_minutes)}</span>
          <span>·</span>
          <span>Global</span>
          {policy.failure_count > 0 && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--error, #ef4444)' }}>{policy.failure_count} failure{policy.failure_count !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>
        <div className={styles.cardToggles}>
          <span className={`${styles.toggle} ${policy.sync_instances ? styles.toggleOn : ''}`}>Instances</span>
          <span className={`${styles.toggle} ${policy.sync_dns ? styles.toggleOn : ''}`}>DNS</span>
          <span className={`${styles.toggle} ${policy.sync_cost ? styles.toggleOn : ''}`}>Cost</span>
        </div>
        <div className={styles.cardStatus}>
          {policy.last_status && (
            <span className={statusClass(policy.last_status)}>
              {policy.last_status === 'success' ? 'Last run: ' : policy.last_status === 'error' ? 'Error: ' : 'Running — '}
            </span>
          )}
          {policy.last_status === 'error' && policy.last_error
            ? <span style={{ color: 'var(--error, #ef4444)' }}>{policy.last_error}</span>
            : <span>{fmtDate(policy.last_run_at)}</span>
          }
          {policy.next_run_at && policy.enabled && (
            <span style={{ marginLeft: 12, color: 'var(--muted)' }}>
              Next: {fmtDate(policy.next_run_at)}
            </span>
          )}
        </div>

        {showHistory && <RunHistory policyId={policy.id} />}
      </div>

      <div className={styles.cardActions}>
        <label className={styles.switch} title={policy.enabled ? 'Enabled' : 'Disabled'}>
          <input type="checkbox" checked={policy.enabled} onChange={toggleEnabled} />
          <span className={styles.switchTrack} />
        </label>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '3px 10px' }}
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? 'Hide history' : 'History'}
        </button>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '3px 10px' }}
          onClick={runNow}
          disabled={running}
        >
          {running ? 'Queued' : 'Run now'}
        </button>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '3px 10px', color: 'var(--error, #ef4444)' }}
          onClick={remove}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AutoUpdatePage() {
  const [policies, setPolicies] = useState<AutoUpdatePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    api.getAutoUpdatePolicies()
      .then(setPolicies)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(policy: AutoUpdatePolicy) {
    setPolicies((prev) => [...prev, policy]);
    setShowForm(false);
  }

  function handleChange(updated: AutoUpdatePolicy) {
    setPolicies((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  function handleDelete(id: string) {
    setPolicies((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Auto-Update</h1>
          <p className={styles.sub}>Automatic background refresh for instances, DNS, and cost data</p>
        </div>
        {!showForm && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + New policy
          </button>
        )}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--error, #ef4444)', fontSize: 13 }}>{error}</p>}

      {showForm && (
        <div style={{ marginBottom: 16 }}>
          <AddPolicyForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {!loading && policies.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-icon">⏱</div>
          <h3>No auto-update policies yet</h3>
          <p>Create a policy to automatically refresh instances, DNS records, and cost data on a schedule.</p>
        </div>
      )}

      {policies.length > 0 && (
        <div className={styles.list}>
          {policies.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onChange={handleChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
