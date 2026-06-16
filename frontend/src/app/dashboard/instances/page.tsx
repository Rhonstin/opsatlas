'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, Instance } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { calcCostToDate, fmtUptime } from '@/lib/cost';
import InstanceDrawer from './InstanceDrawer';
import styles from './instances.module.css';

type InstanceWithDns = Instance & { domains: string[] | null };

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', SGD: 'S$',
  AUD: 'A$', CAD: 'CA$', HKD: 'HK$', INR: '₹', CHF: 'Fr',
};

function sym(currency: string): string { return CURRENCY_SYMBOLS[currency] ?? currency; }
function fmtMonthly(n: string | null, c = 'USD'): string {
  if (!n) return '—';
  return `${sym(c)}${parseFloat(n).toFixed(2)}/mo`;
}
function fmtHourly(n: string | null, c = 'USD'): string {
  if (!n) return '—';
  return `${sym(c)}${parseFloat(n).toFixed(4)}/hr`;
}

function uptimeDays(hours: number | null): number {
  return hours ? Math.floor(hours / 24) : 0;
}

function statusDotClass(s: string): string {
  const upper = s.toUpperCase();
  if (upper === 'RUNNING' || upper === 'RUN') return styles.statusDotRunning;
  if (upper === 'TERMINATED') return styles.statusDotTerminated;
  if (upper === 'STOPPED') return styles.statusDotStopped;
  return styles.statusDotDefault;
}

function statusLabel(s: string): string {
  const upper = s.toUpperCase();
  if (upper === 'RUNNING' || upper === 'RUN') return 'Running';
  if (upper === 'TERMINATED') return 'Terminated';
  if (upper === 'STOPPED') return 'Stopped';
  if (upper === 'SUSPENDED') return 'Suspended';
  return s;
}

type ViewMode = 'all' | 'gcp' | 'aws' | 'hetzner' | 'coolify';

interface Group {
  id: string;
  label: string;
  icon: string;
  items: InstanceWithDns[];
  defaultCollapsed: boolean;
}

function buildGroups(instances: InstanceWithDns[]): Group[] {
  const terminated = instances.filter(i => i.status.toUpperCase() === 'TERMINATED');
  const running = instances.filter(i => {
    const s = i.status.toUpperCase();
    return s === 'RUNNING' || s === 'RUN';
  });
  const longRunning = running.filter(i => uptimeDays(i.uptime_hours) > 90);
  const recentRunning = running.filter(i => uptimeDays(i.uptime_hours) <= 90);
  const other = instances.filter(i => {
    const s = i.status.toUpperCase();
    return s !== 'TERMINATED' && s !== 'RUNNING' && s !== 'RUN';
  });

  const sortDesc = (a: InstanceWithDns, b: InstanceWithDns) =>
    (b.uptime_hours ?? 0) - (a.uptime_hours ?? 0);

  return [
    { id: 'terminated', label: 'Terminated', icon: '🔴', items: terminated.sort(sortDesc), defaultCollapsed: true },
    { id: 'long-running', label: 'Running · Long-running', icon: '🟢', items: longRunning.sort(sortDesc), defaultCollapsed: false },
    { id: 'recent', label: 'Running · Recent', icon: '🟢', items: recentRunning.sort(sortDesc), defaultCollapsed: false },
    { id: 'other', label: 'Other', icon: '🟡', items: other.sort(sortDesc), defaultCollapsed: false },
  ].filter(g => g.items.length > 0);
}

const INITIAL_VISIBLE = 4;

function InstancesPageInner() {
  const isViewer = getUser()?.role === 'viewer';
  const searchParams = useSearchParams();
  const rawView = searchParams.get('view') ?? 'all';
  const initialView = (['all', 'gcp', 'aws', 'hetzner', 'coolify'].includes(rawView) ? rawView : 'all') as ViewMode;

  const [instances, setInstances] = useState<InstanceWithDns[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterResourceType, setFilterResourceType] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>(initialView);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['terminated']));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportInstances({
        ...(view !== 'all' ? { provider: view } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterResourceType ? { resource_type: filterResourceType } : {}),
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opsatlas-instances-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const filtered: InstanceWithDns[] = instances.filter((inst) => {
    if (view !== 'all' && inst.provider !== view) return false;
    if (filterStatus && inst.status.toUpperCase() !== filterStatus.toUpperCase()) return false;
    if (filterResourceType && inst.resource_type !== filterResourceType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        inst.name.toLowerCase().includes(q) ||
        inst.instance_id.toLowerCase().includes(q) ||
        inst.region.toLowerCase().includes(q) ||
        (inst.zone ?? '').toLowerCase().includes(q) ||
        (inst.public_ip ?? '').includes(q) ||
        (inst.private_ip ?? '').includes(q) ||
        inst.connection_name.toLowerCase().includes(q) ||
        (inst.project_name ?? '').toLowerCase().includes(q) ||
        (inst.instance_type ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function fetchInstances() {
    setLoading(true);
    try {
      const data = await api.getInstancesWithDns();
      setInstances(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchInstances(); }, []);

  useEffect(() => {
    api.getServerConfig()
      .then((cfg) => setDisplayCurrency(cfg.preferredCurrency ?? 'USD'))
      .catch(() => {});
  }, []);

  const groups = buildGroups(filtered);

  const totalMonthlyCost = instances.reduce(
    (sum, i) => sum + (i.estimated_monthly_cost ? parseFloat(i.estimated_monthly_cost) : 0), 0,
  );
  const runningCount = instances.filter(i => {
    const s = i.status.toUpperCase();
    return s === 'RUNNING' || s === 'RUN';
  }).length;
  const terminatedCount = instances.filter(i => i.status.toUpperCase() === 'TERMINATED').length;
  const runningPct = instances.length > 0 ? Math.round((runningCount / instances.length) * 100) : 0;

  const providerCount = (p: string) => instances.filter(i => i.provider === p).length;

  function toggleGroup(id: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandGroup(id: string) {
    setExpandedGroups(prev => new Set(prev).add(id));
  }

  function clearFilters() {
    setSearch('');
    setFilterStatus('');
    setFilterResourceType('');
    setView('all');
  }

  const hasActiveFilters = search || filterStatus || filterResourceType || view !== 'all';

  return (
    <div>
      <h1 className={styles.heading} style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>
        Instances
      </h1>

      {/* Metrics bar */}
      <div className={styles.metricsBar}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Total instances</div>
          <div className={styles.metricValue}>{instances.length}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Running</div>
          <div className={styles.metricValue}>{runningCount}</div>
          <div className={styles.metricSub}>{runningPct}% of total</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Terminated</div>
          <div className={`${styles.metricValue} ${terminatedCount > 0 ? styles.metricAlert : ''}`}>{terminatedCount}</div>
          {terminatedCount > 0 && <div className={`${styles.metricSub} ${styles.metricAlert}`}>needs attention</div>}
        </div>
        {!isViewer && (
          <div className={styles.metricCard}>
            <div className={styles.metricLabel}>Est. cost</div>
            <div className={styles.metricValue}>{sym(displayCurrency)}{totalMonthlyCost.toFixed(2)}</div>
            <div className={styles.metricSub}>/month</div>
          </div>
        )}
      </div>

      {/* Alert banner */}
      {terminatedCount > 0 && (
        <div className={styles.alertBanner}>
          <span className={styles.alertBannerIcon}>⚠</span>
          <span className={styles.alertBannerText}>
            {terminatedCount} instance{terminatedCount !== 1 ? 's' : ''} with TERMINATED status need review or deletion
          </span>
          <button className={styles.alertBannerBtn} onClick={() => { setFilterStatus('TERMINATED'); setView('all'); }}>
            Show all
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            type="search"
            placeholder="Search name, IP, region…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          <select value={filterResourceType} onChange={e => setFilterResourceType(e.target.value)} className={styles.filterSelect}>
            <option value="">All types</option>
            <option value="compute">Compute</option>
            <option value="cloudsql">Cloud SQL</option>
            <option value="app">App</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={styles.filterSelect}>
            <option value="">All statuses</option>
            <option value="RUNNING">Running</option>
            <option value="STOPPED">Stopped</option>
            <option value="TERMINATED">Terminated</option>
          </select>
        </div>
        <div className={styles.toolbarRight}>
          <button className="btn-ghost" onClick={handleExport} disabled={exporting || instances.length === 0} style={{ fontSize: 'var(--text-sm)' }}>
            {exporting ? 'Exporting…' : 'Export JSON'}
          </button>
        </div>
      </div>

      {/* Provider tabs */}
      <div className={styles.providerTabs}>
        {(['all', 'gcp', 'aws', 'hetzner', 'coolify'] as ViewMode[]).map(v => {
          const count = v === 'all' ? instances.length : providerCount(v);
          if (v !== 'all' && count === 0) return null;
          return (
            <button
              key={v}
              className={`${styles.providerTab} ${view === v ? styles.providerTabActive : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'all' ? 'All' : v.toUpperCase()}{v !== 'all' ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {loading && <p className={styles.empty}>Loading…</p>}
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>{error}</p>}

      {/* Empty states */}
      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          {hasActiveFilters ? (
            <>
              <div className={styles.emptyIcon}>🔍</div>
              <div className={styles.emptyTitle}>No instances match your filters</div>
              <p className={styles.emptyDesc}>Try adjusting your search or filters.</p>
              <button className="btn-ghost" onClick={clearFilters} style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--text-sm)' }}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <div className={styles.emptyIcon}>🖥</div>
              <div className={styles.emptyTitle}>No instances yet</div>
              <p className={styles.emptyDesc}>Go to Connections and click Sync to fetch your infrastructure.</p>
            </>
          )}
        </div>
      )}

      {/* Grouped instance list */}
      {filtered.length > 0 && (
        <>
          <div className={styles.colHeaders}>
            <span className={styles.thBtn}>Name</span>
            <span className={styles.thBtn}>Status</span>
            <span className={styles.thBtn}>Type</span>
            <span className={styles.thBtn}>Region</span>
            <span className={styles.thBtn}>Uptime</span>
            {!isViewer && <span className={styles.thBtn}>Est. cost</span>}
          </div>

          {groups.map(group => {
            const collapsed = collapsedGroups.has(group.id);
            const expanded = expandedGroups.has(group.id);
            const visible = expanded ? group.items : group.items.slice(0, INITIAL_VISIBLE);
            const hiddenCount = group.items.length - INITIAL_VISIBLE;

            return (
              <div key={group.id} className={styles.group}>
                <div className={styles.groupHeader} onClick={() => toggleGroup(group.id)} role="button" tabIndex={0} aria-expanded={!collapsed}>
                  <span className={styles.groupIcon}>{group.icon}</span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={styles.groupCount}>{group.items.length}</span>
                  <span className={styles.groupToggle}>
                    {collapsed ? '▶' : '▼'}
                  </span>
                </div>
                <hr className={styles.groupDivider} />
                {!collapsed && visible.map(inst => (
                  <div
                    key={inst.id}
                    className={styles.row}
                    onClick={() => setSelectedInstanceId(inst.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedInstanceId(inst.id); }}
                  >
                    <div className={styles.rowName}>
                      <span className={styles.rowNamePrimary}>{inst.name}</span>
                      <span className={styles.rowNameSecondary}>
                        {inst.provider.toUpperCase()} · {inst.project_name ?? inst.connection_name}
                      </span>
                    </div>
                    <div className={styles.statusPill}>
                      <span className={`${styles.statusDot} ${statusDotClass(inst.status)}`} />
                      <span>{statusLabel(inst.status)}</span>
                    </div>
                    <div>
                      <span className={styles.typeBadge}>{inst.resource_type === 'compute' ? inst.instance_type ?? '—' : inst.resource_type}</span>
                    </div>
                    <div className={styles.regionCell}>
                      <div className={styles.regionPrimary}>{inst.region}</div>
                      {inst.zone && <div className={styles.regionSecondary}>{inst.zone}</div>}
                    </div>
                    <div className={styles.uptimeCell}>
                      <span className={styles.uptimeValue}>{fmtUptime(inst.uptime_hours)}</span>
                      <div className={styles.uptimeBar}>
                        <div
                          className={styles.uptimeBarFill}
                          style={{ width: `${Math.min(100, (uptimeDays(inst.uptime_hours) / 365) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {!isViewer && (
                      <div className={styles.costCell}>
                        <span className={styles.costPrimary}>{fmtMonthly(inst.estimated_monthly_cost, displayCurrency)}</span>
                        {inst.status.toUpperCase() === 'RUNNING' && (
                          <span className={styles.costSecondary}>{fmtHourly(inst.estimated_hourly_cost, displayCurrency)}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!collapsed && !expanded && hiddenCount > 0 && (
                  <button className={styles.showMore} onClick={() => expandGroup(group.id)}>
                    Show {hiddenCount} more…
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {selectedInstanceId && (
        <InstanceDrawer instanceId={selectedInstanceId} onClose={() => setSelectedInstanceId(null)} />
      )}
    </div>
  );
}

export default function InstancesPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--muted)', padding: '1.25rem' }}>Loading…</p>}>
      <InstancesPageInner />
    </Suspense>
  );
}
