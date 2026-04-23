'use client';
import { useEffect, useState } from 'react';
import { api, InstanceDetail } from '@/lib/api';
import styles from './instances.module.css';


// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  RUNNING: 'badge-active', RUN: 'badge-active',
  STOPPED: 'badge-error',  TERMINATED: 'badge-error',
  SUSPENDED: 'badge-pending', STAGING: 'badge-pending',
};

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

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function calcCostToDate(inst: InstanceDetail): number {
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

// ── component ─────────────────────────────────────────────────────────────────

export default function InstanceDrawer({
  instanceId,
  onClose,
  onFavoriteToggle,
}: {
  instanceId: string;
  onClose: () => void;
  onFavoriteToggle?: (id: string, isFav: boolean) => void;
}) {
  const [inst, setInst] = useState<InstanceDetail | null>(null);
  const [error, setError] = useState('');
  const [togglingFav, setTogglingFav] = useState(false);

  async function toggleFavorite() {
    if (!inst || togglingFav) return;
    setTogglingFav(true);
    const next = !inst.is_favorited;
    setInst((prev) => prev ? { ...prev, is_favorited: next } : prev);
    onFavoriteToggle?.(inst.id, next);
    try {
      if (inst.is_favorited) {
        await api.removeFavorite(inst.id);
      } else {
        await api.addFavorite(inst.id);
      }
    } catch {
      setInst((prev) => prev ? { ...prev, is_favorited: inst.is_favorited } : prev);
      onFavoriteToggle?.(inst.id, inst.is_favorited);
    } finally {
      setTogglingFav(false);
    }
  }

  // Lock body scroll while drawer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    setInst(null);
    setError('');
    api.getInstance(instanceId)
      .then(setInst)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [instanceId]);

  const isLongRunning =
    inst?.status === 'RUNNING' &&
    inst.uptime_hours !== null &&
    inst.uptime_hours > 30 * 24;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer} role="dialog" aria-modal="true">
        {/* Header — shown immediately, populated once loaded */}
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerTitle}>
              {inst?.name ?? (error ? 'Error' : 'Loading…')}
            </div>
            {inst && (
              <div className={styles.drawerTitleMeta}>
                <span className={`badge ${statusClass(inst.status)}`}>{inst.status}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                  {inst.provider.toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {inst && (
              <button
                className={`${styles.starBtn} ${inst.is_favorited ? styles.starBtnActive : ''}`}
                onClick={toggleFavorite}
                title={inst.is_favorited ? 'Remove from starred' : 'Star this instance'}
                aria-label={inst.is_favorited ? 'Unstar' : 'Star'}
                style={{ fontSize: 18 }}
              >
                {inst.is_favorited ? '★' : '☆'}
              </button>
            )}
            <button className={styles.drawerCloseBtn} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className={styles.drawerBody}>
          {error && <p style={{ color: 'var(--error, #ef4444)', fontSize: 13 }}>{error}</p>}

          {!inst && !error && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
          )}

          {inst && (
            <>
              {/* Long-running warning */}
              {isLongRunning && (
                <div className={styles.drawerWarning}>
                  Running for {fmtUptime(inst.uptime_hours)} — consider stopping if unused.
                </div>
              )}

              {/* Identity */}
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Identity</div>
                <div className={styles.drawerGrid}>
                  <span className={styles.drawerLabel}>Instance ID</span>
                  <span className={styles.drawerMono}>{inst.instance_id}</span>

                  <span className={styles.drawerLabel}>Connection</span>
                  <span className={styles.drawerValue}>{inst.connection_name}</span>

                  {inst.project_name && (
                    <>
                      <span className={styles.drawerLabel}>Project</span>
                      <span className={styles.drawerValue}>{inst.project_name}</span>
                    </>
                  )}

                  <span className={styles.drawerLabel}>Region</span>
                  <span className={styles.drawerValue}>{inst.region}</span>

                  {inst.zone && (
                    <>
                      <span className={styles.drawerLabel}>Zone</span>
                      <span className={styles.drawerMono}>{inst.zone}</span>
                    </>
                  )}

                  <span className={styles.drawerLabel}>
                    {inst.resource_type === 'cloudsql' ? 'Tier' : 'Machine type'}
                  </span>
                  <span className={styles.drawerMono}>{inst.instance_type ?? '—'}</span>

                  {inst.database_version && (
                    <>
                      <span className={styles.drawerLabel}>DB version</span>
                      <span className={styles.drawerMono}>{inst.database_version}</span>
                    </>
                  )}
                </div>
              </div>

              <hr className={styles.drawerDivider} />

              {/* Hardware */}
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Hardware</div>
                <div className={styles.drawerGrid}>
                  <span className={styles.drawerLabel}>vCPUs</span>
                  <span className={styles.drawerValue}>
                    {inst.cpu_count != null ? inst.cpu_count : '—'}
                  </span>

                  <span className={styles.drawerLabel}>RAM</span>
                  <span className={styles.drawerValue}>
                    {inst.ram_gb != null ? `${inst.ram_gb} GB` : '—'}
                  </span>

                  <span className={styles.drawerLabel}>Disks</span>
                  {inst.disks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {inst.disks.map((d, i) => (
                        <div key={i}>
                          <span className={styles.drawerValue}>
                            {d.size_gb} GB{d.boot ? ' · boot' : ''}
                          </span>
                          <div className={styles.drawerMono}>
                            {d.device_name} · {d.type} · {d.iface}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className={styles.drawerMono}>—</span>
                  )}
                </div>
              </div>

              <hr className={styles.drawerDivider} />

              {/* Network */}
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Network</div>
                <div className={styles.drawerGrid}>
                  <span className={styles.drawerLabel}>Public IP</span>
                  <span className={styles.drawerMono}>{inst.public_ip ?? '—'}</span>

                  <span className={styles.drawerLabel}>Private IP</span>
                  <span className={styles.drawerMono}>{inst.private_ip ?? '—'}</span>

                  {inst.domains.length > 0 && (
                    <>
                      <span className={styles.drawerLabel}>Domains</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                              title={isProxied ? 'Cloudflare-proxied' : hostname}
                            >
                              {hostname}
                              {isProxied && <span className={styles.proxiedDot}>⬡</span>}
                            </a>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <hr className={styles.drawerDivider} />

              {/* Cost */}
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Cost</div>
                <div className={styles.drawerGrid}>
                  <span className={styles.drawerLabel}>Hourly</span>
                  <span className={styles.drawerValue}>{fmt(inst.estimated_hourly_cost, inst.provider)}</span>

                  <span className={styles.drawerLabel}>Monthly est.</span>
                  <span className={styles.drawerValue}>{fmtMonthly(inst.estimated_monthly_cost, inst.provider)}</span>

                  {inst.status === 'RUNNING' && (
                    <>
                      <span className={styles.drawerLabel}>Spent this mo</span>
                      <span className={styles.drawerValue}>{currencySymbol(inst.provider)}{calcCostToDate(inst).toFixed(2)}</span>
                    </>
                  )}
                </div>
              </div>

              <hr className={styles.drawerDivider} />

              {/* Timeline */}
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Timeline</div>
                <div className={styles.drawerGrid}>
                  <span className={styles.drawerLabel}>Launched</span>
                  <span className={styles.drawerValue}>{fmtDate(inst.launched_at)}</span>

                  <span className={styles.drawerLabel}>Uptime</span>
                  <span className={styles.drawerValue}>{fmtUptime(inst.uptime_hours)}</span>

                  <span className={styles.drawerLabel}>Last seen</span>
                  <span className={styles.drawerValue}>{fmtDate(inst.last_seen_at)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
