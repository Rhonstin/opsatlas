'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import styles from './settings.module.css';

export default function BillingTab() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');

  useEffect(() => {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedPeriod(current);
    api.getBillingPeriods()
      .then(setPeriods)
      .catch(() => { /* non-fatal */ });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await api.refreshBilling(selectedPeriod || undefined);
      const results = res.results ?? [];
      const ok = results.filter((r: { status: string }) => r.status === 'ok').length;
      const errored = results.filter((r: { status: string }) => r.status === 'error').length;
      const total = results.length;
      if (errored === 0) {
        toast('success', `Billing fetched — ${ok}/${total} connections ok`);
      } else {
        toast('error', `${ok}/${total} connections ok (${errored} failed)`);
      }
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Billing</div>
          <div className={styles.sectionDesc}>
            Fetch actual cost data from your cloud providers for a billing period.{' '}
            <Link href="/dashboard/billing" className={styles.inlineLink}>View actuals →</Link>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Fetch actuals</div>
            <div className={styles.cardDesc}>
              Pull real billing data from GCP (Cloud Billing API), AWS (Cost Explorer), and Hetzner.
              Run this once per month or enable auto-fetch via an Auto-Update policy.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              style={{ width: 130 }}
            >
              {periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              {!periods.includes(selectedPeriod) && selectedPeriod && (
                <option value={selectedPeriod}>{selectedPeriod}</option>
              )}
            </select>
            <button className="btn-primary" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Fetching…' : 'Fetch actuals'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Auto-fetch</div>
        <div className={styles.cardDesc} style={{ marginTop: '0.375rem' }}>
          Enable <strong>Sync cost</strong> in an{' '}
          <Link href="/dashboard/auto-update" className={styles.inlineLink}>Auto-Update policy</Link>{' '}
          to fetch billing data automatically on each sync cycle.
        </div>
      </div>
    </section>
  );
}
