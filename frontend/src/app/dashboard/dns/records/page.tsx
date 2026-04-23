'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, DnsRecord } from '@/lib/api';
import InstanceDrawer from '../../../dashboard/instances/InstanceDrawer';
import styles from './records.module.css';

export default function DnsRecordsPage() {
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeZone, setActiveZone] = useState<string>('all');
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);

  useEffect(() => {
    api.getDnsRecords()
      .then(setRecords)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load records'))
      .finally(() => setLoading(false));
  }, []);

  const zones = Array.from(new Set(records.map((r) => r.zone))).sort();
  const filtered = activeZone === 'all' ? records : records.filter((r) => r.zone === activeZone);

  // Group by zone for display
  const byZone = new Map<string, DnsRecord[]>();
  for (const rec of filtered) {
    if (!byZone.has(rec.zone)) byZone.set(rec.zone, []);
    byZone.get(rec.zone)!.push(rec);
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>DNS Records</h1>
          <p className={styles.sub}>A/AAAA/CNAME records synced from DNS connections</p>
        </div>
      </div>

      {/* Tab strip */}
      <div className={styles.tabs}>
        <Link href="/dashboard/dns" className={styles.tab}>Connections</Link>
        <span className={`${styles.tab} ${styles.tabActive}`}>Records</span>
      </div>

      {loading && <p className={styles.empty}>Loading…</p>}
      {error && <p style={{ color: 'var(--error, #ef4444)' }}>{error}</p>}

      {!loading && records.length === 0 && (
        <p className={styles.empty}>No DNS records found. Sync a DNS connection first.</p>
      )}

      {records.length > 0 && (
        <>
          {/* Zone filter pills */}
          <div className={styles.filters}>
            <button
              className={`${styles.pill} ${activeZone === 'all' ? styles.pillActive : ''}`}
              onClick={() => setActiveZone('all')}
            >
              All ({records.length})
            </button>
            {zones.map((z) => (
              <button
                key={z}
                className={`${styles.pill} ${activeZone === z ? styles.pillActive : ''}`}
                onClick={() => setActiveZone(z)}
              >
                {z} ({records.filter((r) => r.zone === z).length})
              </button>
            ))}
          </div>

          {/* Records grouped by zone */}
          {Array.from(byZone.entries()).map(([zone, zoneRecords]) => (
            <div key={zone} className={styles.zoneSection}>
              {activeZone === 'all' && (
                <div className={styles.zoneLabel}>{zone}</div>
              )}
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <span>Name</span>
                  <span>Type</span>
                  <span>Value</span>
                  <span>TTL</span>
                  <span>Proxied</span>
                  <span>Instance</span>
                </div>
                {zoneRecords.map((rec) => (
                  <div key={rec.id} className={styles.row}>
                    <span className={styles.recordName} title={rec.name}>{rec.name}</span>
                    <span className={styles.typeBadge}>{rec.type}</span>
                    <span className={styles.value} title={rec.value}>{rec.value}</span>
                    <span className={styles.ttl}>{rec.ttl ?? '—'}</span>
                    <span>{rec.proxied ? <span className={styles.proxied}>Yes</span> : <span className={styles.noInstance}>No</span>}</span>
                    <span>
                      {rec.matched_instance_name && rec.matched_instance_id ? (
                        <button
                          className={styles.instanceLink}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                          title={rec.matched_instance_name}
                          onClick={() => setDrawerInstanceId(rec.matched_instance_id!)}
                        >
                          {rec.matched_instance_name}
                        </button>
                      ) : (
                        <span className={styles.noInstance}>—</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {drawerInstanceId && (
        <InstanceDrawer
          instanceId={drawerInstanceId}
          onClose={() => setDrawerInstanceId(null)}
        />
      )}
    </div>
  );
}
