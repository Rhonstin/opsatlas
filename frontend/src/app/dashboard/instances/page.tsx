'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, Instance } from '@/lib/api';
import { useSort } from '@/lib/useSort';
import InstanceDrawer from './InstanceDrawer';
import styles from './instances.module.css';

type InstanceWithDns = Instance & { domains: string[] | null };

const STATUS_BADGE: Record<string, string> = {
  RUNNING: 'badge-active',
  RUN: 'badge-active',
  STOPPED: 'badge-error',
  TERMINATED: 'badge-error',
  SUSPENDED: 'badge-pending',
  STAGING: 'badge-pending',
};

const LONG_RUNNING_HOURS = 30 * 24; // 30 days

function statusClass(s: string): string {
  return STATUS_BADGE[s.toUpperCase()] ?? 'badge-pending';
}

function currencySymbol(provider: string): string {
  return provider === 'hetzner' ? '€' : '$';
}

function fmt(n: string | null, provider = ''): string {
  if (!n) return '—';
  return `${currencySymbol(provider)}${parseFloat(n).toFixed(4)}/hr`;
}

function fmtMonthly(n: string | null, provider = ''): string {
  if (!n) return '—';
  return `${currencySymbol(provider)}${parseFloat(n).toFixed(2)}/mo`;
}

function fmtUptime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function isLongRunning(inst: Instance): boolean {
  return inst.status === 'RUNNING' && inst.uptime_hours !== null && inst.uptime_hours > LONG_RUNNING_HOURS;
}

/** Cost accrued from the start of the current month until now (RUNNING only). */
function calcCostToDate(inst: Instance): number {
  if (inst.status !== 'RUNNING' || !inst.estimated_hourly_cost) return 0;
  const hourly = parseFloat(inst.estimated_hourly_cost);
  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const instanceStart = inst.launched_at
    ? Math.max(new Date(inst.launched_at).getTime(), startOfMonth.getTime())
    : startOfMonth.getTime();
  return hourly * ((now - instanceStart) / 3_600_000);
}

type SortKey = 'name' | 'provider' | 'status' | 'instance_type' | 'region' | 'uptime_hours' | 'estimated_monthly_cost';
type ViewMode = 'all' | 'gcp' | 'aws' | 'hetzner' | 'starred';

function InstancesPageInner() {
  const searchParams = useSearchParams();
  const rawView = searchParams.get('view') ?? 'all';
  const initialView = (['all', 'gcp', 'aws', 'hetzner', 'starred'].includes(rawView) ? rawView : 'all') as ViewMode;

  const [instances, setInstances] = useState<InstanceWithDns[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterResourceType, setFilterResourceType] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>(initialView);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [togglingFav, setTogglingFav] = useState<string | null>(null);

  const filtered: InstanceWithDns[] = instances.filter((inst) => {
    if (view === 'starred' && !inst.is_favorited) return false;
    if (view !== 'all' && view !== 'starred' && inst.provider !== view) return false;
    if (filterStatus && inst.status !== filterStatus) return false;
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
        (inst.instance_type ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const { sorted, toggle, indicator } = useSort<InstanceWithDns & Record<string, unknown>, SortKey>(
    filtered as (InstanceWithDns & Record<string, unknown>)[],
    'name',
  );

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterStatus) params.status = filterStatus;
      if (filterResourceType) params.resource_type = filterResourceType;
      const data = await api.getInstancesWithDns(params);
      setInstances(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterResourceType]);

  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  async function toggleFavorite(inst: InstanceWithDns, e: React.MouseEvent) {
    e.stopPropagation();
    if (togglingFav === inst.id) return;
    setTogglingFav(inst.id);

    // Optimistic update
    setInstances((prev) =>
      prev.map((i) => i.id === inst.id ? { ...i, is_favorited: !i.is_favorited } : i),
    );

    try {
      if (inst.is_favorited) {
        await api.removeFavorite(inst.id);
      } else {
        await api.addFavorite(inst.id);
      }
    } catch {
      // Revert on failure
      setInstances((prev) =>
        prev.map((i) => i.id === inst.id ? { ...i, is_favorited: inst.is_favorited } : i),
      );
    } finally {
      setTogglingFav(null);
    }
  }

  const totalMonthlyCost = instances.reduce(
    (sum, i) => sum + (i.estimated_monthly_cost ? parseFloat(i.estimated_monthly_cost) : 0),
    0,
  );

  const providerCount = (p: string) => instances.filter((i) => i.provider === p).length;
  const starredCount = instances.filter((i) => i.is_favorited).length;

  function col(key: SortKey, label: string) {
    return (
      <button className={styles.thBtn} onClick={() => toggle(key)}>
        {label}<span className={styles.indicator}>{indicator(key)}</span>
      </button>
    );
  }

  function viewTab(v: ViewMode, label: string, count?: number) {
    return (
      <button
        className={`${styles.viewTab} ${view === v ? styles.viewTabActive : ''}`}
        onClick={() => setView(v)}
      >
        {label}{count !== undefined && count > 0 ? ` (${count})` : ''}
      </button>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Instances</h1>
          <p className={styles.sub}>{instances.length} instance{instances.length !== 1 ? 's' : ''} · est. {`$${totalMonthlyCost.toFixed(2)}/mo`}</p>
        </div>
        <div className={styles.filters}>
          <input
            type="search"
            placeholder="Search name, IP, region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          <select value={filterResourceType} onChange={(e) => setFilterResourceType(e.target.value)} style={{ width: 130 }}>
            <option value="">All types</option>
            <option value="compute">Compute</option>
            <option value="cloudsql">Cloud SQL</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ width: 130 }}>
            <option value="">All statuses</option>
            <option value="RUNNING">Running</option>
            <option value="STOPPED">Stopped</option>
            <option value="TERMINATED">Terminated</option>
          </select>
        </div>
      </div>

      <div className={styles.viewTabs}>
        {viewTab('all', 'All')}
        {viewTab('gcp', 'GCP', providerCount('gcp'))}
        {viewTab('aws', 'AWS', providerCount('aws'))}
        {viewTab('hetzner', 'Hetzner', providerCount('hetzner'))}
        {viewTab('starred', '★ Starred', starredCount)}
      </div>

      {loading && <p className={styles.empty}>Loading…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          {view === 'starred' ? (
            <>
              <div className="empty-state-icon">★</div>
              <h3>No starred instances</h3>
              <p>Click the star on any instance to pin it here for quick access.</p>
            </>
          ) : view === 'all' && !search && !filterStatus && !filterResourceType ? (
            <>
              <div className="empty-state-icon">🖥</div>
              <h3>No instances yet</h3>
              <p>Go to Connections and click Sync to fetch your infrastructure from GCP, Hetzner, or AWS.</p>
            </>
          ) : view !== 'all' ? (
            <>
              <div className="empty-state-icon">🖥</div>
              <h3>No {view.toUpperCase()} instances</h3>
              <p>No instances found for this provider. Add a {view.toUpperCase()} connection and sync.</p>
            </>
          ) : (
            <>
              <div className="empty-state-icon">🔍</div>
              <h3>No results</h3>
              <p>Try adjusting your search or filters.</p>
            </>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <div className={styles.tableWrap}>
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            {col('name', 'Name')}
            {col('provider', 'Provider')}
            {col('status', 'Status')}
            {col('instance_type', 'Type')}
            {col('region', 'Region / Zone')}
            {col('uptime_hours', 'Uptime')}
            <button
              className={styles.thBtn}
              onClick={() => toggle('estimated_monthly_cost')}
              title="Compute (CPU + RAM) + persistent disks. Excludes network egress, Cloud Storage, and other services."
            >
              Est. cost<span className={styles.indicator}>{indicator('estimated_monthly_cost')}</span>
              <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>*</span>
            </button>
            <span>IPs / Domains</span>
          </div>
          {sorted.map((inst) => (
            <div key={inst.id} className={`${styles.row} ${isLongRunning(inst) ? styles.rowWarning : ''}`}>
              <div className={styles.nameCell}>
                <button
                  className={`${styles.starBtn} ${inst.is_favorited ? styles.starBtnActive : ''}`}
                  onClick={(e) => toggleFavorite(inst, e)}
                  title={inst.is_favorited ? 'Remove from starred' : 'Star this instance'}
                  aria-label={inst.is_favorited ? 'Unstar' : 'Star'}
                >
                  {inst.is_favorited ? '★' : '☆'}
                </button>
                <div>
                  <button
                    className={styles.instNameBtn}
                    onClick={() => setSelectedInstanceId(inst.id)}
                  >
                    {inst.name}
                  </button>
                  <div className={styles.instId}>{inst.instance_id}</div>
                </div>
              </div>
              <div>
                <span className={styles.provider}>{inst.provider.toUpperCase()}</span>
                {inst.resource_type && inst.resource_type !== 'compute' && (
                  <div className={styles.resourceTypeBadge}>{inst.resource_type}</div>
                )}
              </div>
              <span>
                <span className={`badge ${statusClass(inst.status)}`}>
                  {inst.status}
                </span>
              </span>
              <span className={styles.muted}>{inst.instance_type ?? '—'}</span>
              <div>
                <div>{inst.region}</div>
                {inst.zone && <div className={styles.instId}>{inst.zone}</div>}
              </div>
              <div>
                <span className={styles.muted}>{fmtUptime(inst.uptime_hours)}</span>
                {isLongRunning(inst) && (
                  <span className={styles.longRunningBadge}>long-running</span>
                )}
              </div>
              <div>
                <div>{fmtMonthly(inst.estimated_monthly_cost, inst.provider)}</div>
                {inst.status === 'RUNNING'
                  ? <div className={styles.instId}>{fmt(inst.estimated_hourly_cost, inst.provider)}</div>
                  : inst.estimated_monthly_cost && parseFloat(inst.estimated_monthly_cost) > 0
                    ? <div className={styles.instId} style={{ color: 'var(--muted)' }}>disk only</div>
                    : null
                }
                {inst.status === 'RUNNING' && (
                  <div className={styles.costToDate}>
                    {currencySymbol(inst.provider)}{calcCostToDate(inst).toFixed(2)} this mo
                  </div>
                )}
              </div>
              <div className={styles.ipCell}>
                {inst.public_ip && <div>{inst.public_ip}</div>}
                {inst.private_ip && <div className={styles.instId}>{inst.private_ip}</div>}
                {!inst.public_ip && !inst.private_ip && <span className={styles.muted}>—</span>}
                {inst.domains && inst.domains.length > 0 && (
                  <div className={styles.domains}>
                    {inst.domains.map((d) => {
                      const isProxied = d.endsWith(' (proxied)');
                      const hostname = isProxied ? d.slice(0, -' (proxied)'.length) : d;
                      return (
                        <a
                          key={d}
                          href={`https://${hostname}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.domainTag}
                          title={isProxied ? 'Cloudflare-proxied (IP is edge, not instance)' : hostname}
                        >
                          {hostname}
                          {isProxied && <span className={styles.proxiedDot} title="Cloudflare proxied">⬡</span>}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      )}
      {sorted.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          * Running instances: compute (CPU + RAM) + persistent disk. Stopped/terminated instances: disk storage only (compute = $0). Network egress and managed services excluded.
        </p>
      )}

      {selectedInstanceId && (
        <InstanceDrawer
          instanceId={selectedInstanceId}
          onClose={() => setSelectedInstanceId(null)}
          onFavoriteToggle={(id, isFav) => {
            setInstances((prev) =>
              prev.map((i) => i.id === id ? { ...i, is_favorited: isFav } : i),
            );
          }}
        />
      )}
    </div>
  );
}

export default function InstancesPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--muted)', padding: '20px' }}>Loading…</p>}>
      <InstancesPageInner />
    </Suspense>
  );
}
