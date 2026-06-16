'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getUser } from '@/lib/auth';
import ConnectionsTab from './ConnectionsTab';
import DnsTab from './DnsTab';
import BillingTab from './BillingTab';
import SsoTab from './SsoTab';
import SecurityTab from './SecurityTab';
import ConfigTab from './ConfigTab';
import ApiKeysTab from './ApiKeysTab';
import styles from './settings.module.css';

type Tab = 'connections' | 'dns' | 'billing' | 'sso' | 'security' | 'config' | 'api-keys';

const TABS: { id: Tab; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'dns', label: 'DNS' },
  { id: 'billing', label: 'Billing' },
  { id: 'sso', label: 'SSO' },
  { id: 'security', label: 'Security' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'config', label: 'Config' },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (getUser()?.role === 'viewer') router.replace('/dashboard');
  }, [router]);

  if (getUser()?.role === 'viewer') return null;

  const raw = searchParams.get('tab') ?? 'connections';
  const tab = (TABS.some((t) => t.id === raw) ? raw : 'connections') as Tab;

  function setTab(t: Tab) {
    router.push(`/dashboard/settings?tab=${t}`, { scroll: false });
  }

  return (
    <div>
      <h1 className={styles.heading}>Settings</h1>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'dns' && <DnsTab />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'sso' && <SsoTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'api-keys' && <ApiKeysTab />}
        {tab === 'config' && <ConfigTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--muted)', padding: 20 }}>Loading…</p>}>
      <SettingsContent />
    </Suspense>
  );
}
