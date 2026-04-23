'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearAuth } from '@/lib/auth';
import { ToastProvider } from '@/lib/toast';
import styles from './layout.module.css';

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

function IconInstances() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="3" width="14" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="9" width="14" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="12.5" cy="5" r="1" fill="currentColor"/>
      <circle cx="12.5" cy="11" r="1" fill="currentColor"/>
    </svg>
  );
}

function IconDns() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M1.5 8h13M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function IconAutoUpdate() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M10 3.5l2.5 1-1 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconBilling() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M1 6.5h14" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="3" y="9" width="3" height="1.5" rx="0.5" fill="currentColor"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.42 1.42M11.65 11.65l1.42 1.42M2.93 13.07l1.42-1.42M11.65 4.35l1.42-1.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function IconSignOut() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M11 5l3 3-3 3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: <IconDashboard />, exact: true },
  { href: '/dashboard/instances', label: 'Instances', icon: <IconInstances />, exact: false },
  { href: '/dashboard/dns/records', label: 'DNS', icon: <IconDns />, exact: false },
  { href: '/dashboard/auto-update', label: 'Auto-Update', icon: <IconAutoUpdate />, exact: false },
  { href: '/dashboard/billing', label: 'Billing', icon: <IconBilling />, exact: false },
  { href: '/dashboard/settings', label: 'Settings', icon: <IconSettings />, exact: false },
];

// ── Layout ────────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) router.replace('/login');
  }, [router]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => { setUser(getUser()); }, []);

  function logout() {
    clearAuth();
    router.replace('/login');
  }

  function isActive(item: typeof NAV[0]): boolean {
    if (item.exact) return pathname === item.href;
    // For DNS: match /dashboard/dns/*
    if (item.href.includes('/dns/')) return pathname.startsWith('/dashboard/dns');
    // For others: match on the second segment (/dashboard/X)
    const seg = item.href.split('/')[2]; // e.g. 'instances', 'billing', etc.
    return pathname.startsWith(`/dashboard/${seg}`);
  }

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <nav className={styles.nav}>
          <Link href="/dashboard" className={styles.navLogo}>
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="navG" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a78bfa"/>
                  <stop offset="100%" stopColor="#4f46e5"/>
                </linearGradient>
              </defs>
              <circle cx="16" cy="16" r="10.5" stroke="url(#navG)" strokeWidth="1.8"/>
              <ellipse cx="16" cy="16" rx="10.5" ry="4" stroke="url(#navG)" strokeWidth="1.2" transform="rotate(-38 16 16)"/>
              <ellipse cx="16" cy="16" rx="10.5" ry="4" stroke="url(#navG)" strokeWidth="1.2" transform="rotate(38 16 16)"/>
              <circle cx="16" cy="16" r="2" fill="#a78bfa"/>
            </svg>
            opsatlas
          </Link>

          <button
            className={styles.menuBtn}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          <div className={`${styles.navLinks} ${menuOpen ? styles.navLinksOpen : ''}`}>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={isActive(item) ? styles.linkActive : styles.link}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>

          <div className={`${styles.navRight} ${menuOpen ? styles.navRightOpen : ''}`}>
            {user?.email && <span className={styles.userEmail}>{user.email}</span>}
            <button className={styles.signOutBtn} onClick={logout}>
              <IconSignOut />
              Sign out
            </button>
          </div>
        </nav>

        <main className={styles.main}>{children}</main>
      </div>
    </ToastProvider>
  );
}
