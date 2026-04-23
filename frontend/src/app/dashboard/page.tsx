'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Instance, Connection, CostSummary, CostByProject, BillingActual } from '@/lib/api';
import styles from './page.module.css';

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMonthly(n: number): string { return `${fmtUsd(n)}/mo`; }

function fmtUptime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [billingActuals, setBillingActuals] = useState<BillingActual[]>([]);

  useEffect(() => {
    api.getInstances().then(setInstances).catch(() => {});
    api.getConnections().then(setConnections).catch(() => {});
    api.getCostSummary().then(setCostSummary).catch(() => {});
    api.getBillingActuals(currentPeriod()).then(setBillingActuals).catch(() => {});
  }, []);

  // ── Estimated costs ──────────────────────────────────────────────────────
  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  function costToDate(i: Instance): number {
    if (i.status !== 'RUNNING' || !i.estimated_hourly_cost) return 0;
    const hourly = parseFloat(i.estimated_hourly_cost);
    const start = i.launched_at
      ? Math.max(new Date(i.launched_at).getTime(), startOfMonth.getTime())
      : startOfMonth.getTime();
    return hourly * ((now - start) / 3_600_000);
  }

  const estMonthly = instances.reduce(
    (s, i) => s + (i.estimated_monthly_cost ? parseFloat(i.estimated_monthly_cost) : 0), 0,
  );

  // ── Actual billing totals ────────────────────────────────────────────────
  const actualTotal = billingActuals.reduce((s, b) => s + parseFloat(b.amount_usd), 0);
  const hasActuals = billingActuals.length > 0;

  // ── Per-provider breakdown ───────────────────────────────────────────────
  const providers = ['gcp', 'aws', 'hetzner'] as const;

  type ProviderStats = {
    instances: number;
    running: number;
    estMonthly: number;
    actualMonthly: number;
  };

  const providerStats: Record<string, ProviderStats> = {};
  for (const p of providers) {
    const pInstances = instances.filter((i) => i.provider === p);
    const pActuals = billingActuals.filter((b) => b.provider === p);
    providerStats[p] = {
      instances: pInstances.length,
      running: pInstances.filter((i) => i.status === 'RUNNING').length,
      estMonthly: pInstances.reduce(
        (s, i) => s + (i.estimated_monthly_cost ? parseFloat(i.estimated_monthly_cost) : 0), 0,
      ),
      actualMonthly: pActuals.reduce((s, b) => s + parseFloat(b.amount_usd), 0),
    };
  }

  // ── Fleet health ─────────────────────────────────────────────────────────
  const running = instances.filter((i) => i.status === 'RUNNING').length;
  const longRunning = costSummary?.long_running.length ?? 0;
  const idleCandidates = costSummary?.idle_candidates.length ?? 0;
  const domainsMapped = costSummary?.domains_mapped ?? 0;

  // ── Per-project estimated to-date ────────────────────────────────────────
  const projectToDate = new Map<string, number>();
  for (const i of instances) {
    const key = i.project_or_account_id ?? i.connection_id;
    projectToDate.set(key, (projectToDate.get(key) ?? 0) + costToDate(i));
  }

  const activeProviders = providers.filter((p) => providerStats[p].instances > 0);

  return (
    <div>
      <h1 className={styles.heading}>Dashboard</h1>
      <p className={styles.sub}>Multi-cloud infrastructure overview</p>

      {/* ── Row 1: fleet overview ── */}
      <div className={styles.cards}>
        <div className="card">
          <div className={styles.cardTitle}>Instances</div>
          <div className={styles.cardValue}>
            <Link href="/dashboard/instances">{instances.length}</Link>
          </div>
          <div className={styles.cardNote}>
            {running} running
            {activeProviders.length > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
                · {activeProviders.map((p) => `${p.toUpperCase()} ${providerStats[p].instances}`).join(' · ')}
              </span>
            )}
          </div>
        </div>

        <div className="card">
          <div className={styles.cardTitle}>Connections</div>
          <div className={styles.cardValue}>
            <Link href="/dashboard/connections">{connections.length}</Link>
          </div>
          <div className={styles.cardNote}>
            {connections.filter((c) => c.status === 'active').length} active
          </div>
        </div>

        {/* Actual spend card — shows real billing when available, else estimate */}
        <div className="card">
          <div className={styles.cardTitle}>
            {hasActuals ? 'Actual Spend' : 'Est. Spend'}
            <span className={styles.periodBadge}>{currentPeriod()}</span>
          </div>
          <div className={styles.cardValue}>
            {hasActuals ? fmtUsd(actualTotal) : (instances.length ? fmtUsd(instances.reduce((s, i) => s + costToDate(i), 0)) : '—')}
          </div>
          <div className={styles.cardNote}>
            {hasActuals
              ? `${fmtUsd(estMonthly)}/mo est. · ${actualTotal > 0 ? ((actualTotal / estMonthly) * 100).toFixed(0) : '—'}% of est.`
              : `${fmtMonthly(estMonthly)} projected`}
          </div>
        </div>

        <div className="card">
          <div className={styles.cardTitle}>Est. Monthly Cost</div>
          <div className={styles.cardValue}>
            {instances.length ? fmtMonthly(estMonthly) : '—'}
          </div>
          <div className={styles.cardNote}>Full month at current rate</div>
        </div>
      </div>

      {/* ── Row 2: health signals ── */}
      {(longRunning > 0 || idleCandidates > 0 || domainsMapped > 0) && (
        <div className={styles.cards} style={{ marginTop: 16 }}>
          {longRunning > 0 && (
            <div className="card">
              <div className={styles.cardTitle}>Long-running</div>
              <div className={styles.cardValue}>
                <Link href="/dashboard/instances">{longRunning}</Link>
              </div>
              <div className={styles.cardNote}>Running &gt; 30 days</div>
            </div>
          )}
          {idleCandidates > 0 && (
            <div className="card">
              <div className={styles.cardTitle}>Idle candidates</div>
              <div className={styles.cardValue}>
                <Link href="/dashboard/instances">{idleCandidates}</Link>
              </div>
              <div className={styles.cardNote}>Stopped instances</div>
            </div>
          )}
          {domainsMapped > 0 && (
            <div className="card">
              <div className={styles.cardTitle}>Domains mapped</div>
              <div className={styles.cardValue}>
                <Link href="/dashboard/dns/records">{domainsMapped}</Link>
              </div>
              <div className={styles.cardNote}>DNS records → instances</div>
            </div>
          )}
        </div>
      )}

      {/* ── Provider cost breakdown ── */}
      {activeProviders.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cost by provider</h2>
          <div className={styles.breakdown}>
            {activeProviders.map((p) => {
              const s = providerStats[p];
              const hasAct = s.actualMonthly > 0;
              return (
                <Link key={p} href={`/dashboard/billing?provider=${p}`} className={styles.breakdownRow} style={{ textDecoration: 'none', color: 'inherit', display: 'flex' }}>
                  <div className={styles.breakdownLeft}>
                    <span className={styles.breakdownName}>{p.toUpperCase()}</span>
                    <span className={styles.breakdownMeta}>
                      {s.instances} instance{s.instances !== 1 ? 's' : ''} · {s.running} running
                      {!hasAct && (
                        <span className={styles.noActuals}> · billing data pending</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.breakdownCosts}>
                    {hasAct ? (
                      <>
                        <span className={styles.breakdownCost}>{fmtUsd(s.actualMonthly)} actual</span>
                        <span className={styles.breakdownToDate}>{fmtMonthly(s.estMonthly)} est.</span>
                      </>
                    ) : (
                      <span className={styles.breakdownCost}>{fmtMonthly(s.estMonthly)} est.</span>
                    )}
                  </div>
                </Link>
              );
            })}
            {/* Total row — actual only counts providers with real data */}
            {(() => {
              const providersWithActuals = activeProviders.filter((p) => providerStats[p].actualMonthly > 0);
              const partialActual = providersWithActuals.length > 0 && providersWithActuals.length < activeProviders.length;
              return (
                <div className={`${styles.breakdownRow} ${styles.breakdownTotal}`}>
                  <div className={styles.breakdownLeft}>
                    <span className={styles.breakdownName}>Total</span>
                    {partialActual && (
                      <span className={styles.breakdownMeta}>
                        actual: {providersWithActuals.map((p) => p.toUpperCase()).join(' + ')} only
                      </span>
                    )}
                  </div>
                  <div className={styles.breakdownCosts}>
                    {actualTotal > 0 && (
                      <span className={styles.breakdownCost}>{fmtUsd(actualTotal)} actual</span>
                    )}
                    <span className={styles.breakdownToDate}>{fmtMonthly(estMonthly)} est.</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Cost by project ── */}
      {costSummary && costSummary.by_project.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cost by project</h2>
          <div className={styles.breakdown}>
            {costSummary.by_project.map((p: CostByProject) => (
              <div key={p.key} className={styles.breakdownRow}>
                <div className={styles.breakdownLeft}>
                  <div>
                    <span className={styles.breakdownName}>{p.project_name}</span>
                    {p.project_external_id && p.project_external_id !== p.project_name && (
                      <span className={styles.breakdownId}>{p.project_external_id}</span>
                    )}
                  </div>
                  <span className={styles.breakdownMeta}>
                    {p.provider.toUpperCase()} · {p.instance_count} instance{p.instance_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className={styles.breakdownCosts}>
                  <span className={styles.breakdownCost}>{fmtMonthly(p.total_monthly)}</span>
                  {(projectToDate.get(p.key) ?? 0) > 0 && (
                    <span className={styles.breakdownToDate}>
                      {fmtUsd(projectToDate.get(p.key) ?? 0)} this mo
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top expensive instances ── */}
      {costSummary && costSummary.top_expensive.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Top expensive instances</h2>
          <div className={styles.breakdown}>
            {costSummary.top_expensive.map((inst, i) => (
              <div key={inst.id} className={styles.breakdownRow}>
                <div className={styles.breakdownLeft}>
                  <span className={styles.breakdownRank}>#{i + 1}</span>
                  <div>
                    <span className={styles.breakdownName}>{inst.name}</span>
                    <span className={styles.breakdownMeta}>
                      {inst.instance_type ?? inst.provider.toUpperCase()} · {inst.region} · uptime {fmtUptime(inst.uptime_hours)}
                    </span>
                  </div>
                </div>
                <span className={styles.breakdownCost}>{fmtMonthly(inst.monthly_cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
