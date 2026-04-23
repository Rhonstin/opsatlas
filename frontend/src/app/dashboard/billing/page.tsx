'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, BillingActual, BillingRefreshResult } from '@/lib/api';
import styles from './billing.module.css';

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPeriod(p: string): string {
  const [y, m] = p.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

type ProviderTab = 'all' | 'gcp' | 'aws' | 'hetzner';

function BillingContent() {
  const [actuals, setActuals] = useState<BillingActual[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const searchParams = useSearchParams();
  const [providerTab, setProviderTab] = useState<ProviderTab>(() => {
    const p = searchParams.get('provider');
    return (p === 'gcp' || p === 'aws' || p === 'hetzner') ? p : 'all';
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<BillingRefreshResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getBillingPeriods().then(setPeriods).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getBillingActuals(period)
      .then(setActuals)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [period]);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await api.refreshBilling(period);
      setRefreshResult(result);
      const updated = await api.getBillingActuals(period);
      setActuals(updated);
      const updatedPeriods = await api.getBillingPeriods();
      setPeriods(updatedPeriods);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  // Per-provider totals for tab badges
  const providerTotals: Record<string, number> = {};
  for (const r of actuals) {
    providerTotals[r.provider] = (providerTotals[r.provider] ?? 0) + parseFloat(r.amount_usd);
  }

  const filteredActuals = providerTab === 'all' ? actuals : actuals.filter((r) => r.provider === providerTab);
  const totalActual = filteredActuals.reduce((s, r) => s + parseFloat(r.amount_usd), 0);

  // Group by connection
  const byConnection = new Map<string, { name: string; provider: string; total: number }>();
  for (const r of filteredActuals) {
    const existing = byConnection.get(r.connection_id) ?? { name: r.connection_name, provider: r.provider, total: 0 };
    existing.total += parseFloat(r.amount_usd);
    byConnection.set(r.connection_id, existing);
  }

  // Group by service
  const byService = new Map<string, number>();
  for (const r of filteredActuals) {
    byService.set(r.service, (byService.get(r.service) ?? 0) + parseFloat(r.amount_usd));
  }
  const topServices = [...byService.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxService = topServices[0]?.[1] ?? 1;

  // Group by project
  const byProject = new Map<string, { name: string; id: string | null; total: number }>();
  for (const r of filteredActuals) {
    const key = r.project_id ?? r.project_name ?? 'Unknown';
    const existing = byProject.get(key) ?? { name: r.project_name ?? r.project_id ?? 'Unknown', id: r.project_id, total: 0 };
    existing.total += parseFloat(r.amount_usd);
    byProject.set(key, existing);
  }
  const topProjects = [...byProject.values()].sort((a, b) => b.total - a.total).slice(0, 8);

  const tabs: { key: ProviderTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'gcp', label: 'GCP' },
    { key: 'aws', label: 'AWS' },
    { key: 'hetzner', label: 'Hetzner' },
  ];

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Billing</h1>
          <p className={styles.sub}>Actual cloud spend from GCP Billing Export and AWS Cost Explorer</p>
        </div>
        <button className="btn-primary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Fetching…' : 'Fetch actuals'}
        </button>
      </div>

      {/* Setup hints */}
      <div className={styles.setupHints}>
        <div className={styles.setupHintRow}>
          <span className={styles.setupHintProvider}>GCP</span>
          <span>
            Add <code>&quot;billing_dataset&quot;: &quot;project_id.dataset_name&quot;</code> to your service account JSON to enable BigQuery billing export.
          </span>
        </div>
        <div className={styles.setupHintRow}>
          <span className={styles.setupHintProvider}>AWS</span>
          <span>Ensure your IAM user has the <code>ce:GetCostAndUsage</code> permission.</span>
        </div>
        <div className={styles.setupHintRow}>
          <span className={styles.setupHintProvider}>Hetzner</span>
          <span>Billing is pulled automatically from the Cloud API using your existing API token.</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ minWidth: 160 }}>
          {!periods.includes(period) && (
            <option value={period}>{fmtPeriod(period)} (current)</option>
          )}
          {periods.map((p) => (
            <option key={p} value={p}>{fmtPeriod(p)}{p === period ? ' (current)' : ''}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {actuals.length > 0 ? `${actuals.length} line items · last fetched ${new Date(actuals[0].fetched_at).toLocaleString()}` : ''}
        </span>
      </div>

      {/* Provider tabs */}
      <div className={styles.tabs}>
        {tabs.map((t) => {
          const total = t.key === 'all'
            ? Object.values(providerTotals).reduce((s, v) => s + v, 0)
            : (providerTotals[t.key] ?? 0);
          return (
            <button
              key={t.key}
              className={`${styles.tab} ${providerTab === t.key ? styles.tabActive : ''}`}
              onClick={() => setProviderTab(t.key)}
            >
              {t.label}
              {actuals.length > 0 && total > 0 && (
                <span className={styles.tabBadge}>{fmtUsd(total)}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Refresh result log */}
      {refreshResult && (
        <div className={styles.resultLog}>
          {refreshResult.results.map((r) => (
            <div key={r.connection_id} className={styles.resultRow}>
              <span className={`${styles.dot} ${r.status === 'ok' ? styles.dotOk : r.status === 'skipped' ? styles.dotSkipped : styles.dotError}`} />
              <span><strong>{r.connection_name}</strong> ({r.provider.toUpperCase()})</span>
              {r.status === 'ok' && <span className={styles.resultMsg}>{r.rows_upserted} line items imported</span>}
              {r.status === 'skipped' && <span className={styles.resultMsg}>skipped — {r.message}</span>}
              {r.status === 'error' && <span style={{ color: 'var(--error, #ef4444)', fontSize: 12 }}>{r.message}</span>}
            </div>
          ))}
        </div>
      )}

      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--error, #ef4444)', fontSize: 13 }}>{error}</p>}

      {/* Hetzner — no actuals yet */}
      {!loading && providerTab === 'hetzner' && filteredActuals.length === 0 && (
        <div className={styles.empty}>
          <p style={{ fontWeight: 600 }}>No Hetzner billing data for {fmtPeriod(period)}</p>
          <p>Click <strong>Fetch actuals</strong> to pull invoice data from the Hetzner Cloud API.</p>
        </div>
      )}

      {!loading && providerTab !== 'hetzner' && filteredActuals.length === 0 && !refreshResult && (
        <div className={styles.empty}>
          <p>No billing data for {providerTab === 'all' ? '' : providerTab.toUpperCase() + ' · '}{fmtPeriod(period)}.</p>
          <p>Click <strong>Fetch actuals</strong> to pull data from GCP and AWS.</p>
        </div>
      )}

      {filteredActuals.length > 0 && (
        <>
          {/* Summary cards */}
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>
                {providerTab === 'all' ? 'Total spend' : `${providerTab.toUpperCase()} spend`}
              </div>
              <div className={styles.cardValue}>{fmtUsd(totalActual)}</div>
              <div className={styles.cardSub}>{fmtPeriod(period)}</div>
            </div>
            {[...byConnection.values()].map((c) => (
              <div key={c.name} className={styles.card}>
                <div className={styles.cardLabel}>{c.provider.toUpperCase()}</div>
                <div className={styles.cardValue}>{fmtUsd(c.total)}</div>
                <div className={styles.cardSub}>{c.name}</div>
              </div>
            ))}
          </div>

          <div className={styles.columns}>
            {/* Top services */}
            {topServices.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Top services</div>
                <div className={styles.table}>
                  {topServices.map(([service, amount]) => (
                    <div key={service} className={styles.serviceRow}>
                      <div className={styles.serviceInfo}>
                        <div className={styles.serviceName}>{service}</div>
                        <div className={styles.bar} style={{ width: `${(amount / maxService) * 100}%` }} />
                      </div>
                      <div className={styles.amount}>{fmtUsd(amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top projects / accounts */}
            {topProjects.length > 1 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  {providerTab === 'aws' ? 'Top accounts' : 'Top projects'}
                </div>
                <div className={styles.table}>
                  {topProjects.map((proj) => (
                    <div key={proj.id ?? proj.name} className={styles.projectRow}>
                      <div className={styles.projectInfo}>
                        <div className={styles.projectName}>{proj.name}</div>
                        {proj.id && proj.id !== proj.name && (
                          <div className={styles.projectId}>{proj.id}</div>
                        )}
                      </div>
                      <div className={styles.amount}>{fmtUsd(proj.total)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Full line items */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Line items · {filteredActuals.length} rows</div>
            <div className={styles.table}>
              <div className={styles.tableHeader}>
                <span>Connection</span>
                <span>Project</span>
                <span>Service</span>
                <span>Amount</span>
                {providerTab === 'all' && <span>Provider</span>}
              </div>
              {filteredActuals.map((r) => (
                <div key={r.id} className={`${styles.row} ${providerTab === 'all' ? styles.rowFull : styles.rowNoProvider}`}>
                  <span className={styles.connName} title={r.connection_name}>{r.connection_name}</span>
                  <span className={styles.project} title={r.project_name ?? r.project_id ?? '—'}>{r.project_name ?? r.project_id ?? '—'}</span>
                  <span className={styles.service} title={r.service}>{r.service}</span>
                  <span className={styles.amount}>{fmtUsd(parseFloat(r.amount_usd))}</span>
                  {providerTab === 'all' && <span className={styles.provider}>{r.provider.toUpperCase()}</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--muted)' }}>Loading…</p>}>
      <BillingContent />
    </Suspense>
  );
}
