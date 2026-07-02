'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearAuth, AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { ToastProvider } from '@/lib/toast';
import ThemeToggle from '@/components/ThemeToggle';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) router.replace('/login');
  }, [router]);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function logout() {
    api.logout().catch(() => {/* best effort */});
    clearAuth();
    router.replace('/login');
  }

  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { setUser(getUser()); }, []);

  const isViewer = user?.role === 'viewer';

  return (
    <ToastProvider>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className={styles.shell}>
        <nav className={styles.nav}>
          <Link href="/dashboard" className={styles.navLogo}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
            {isViewer ? (
              <Link href="/dashboard/instances" className={pathname.startsWith('/dashboard/instances') || pathname === '/dashboard' ? styles.linkActive : styles.link}>
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/dashboard" className={pathname === '/dashboard' ? styles.linkActive : styles.link}>
                  Dashboard
                </Link>
                <Link href="/dashboard/instances" className={pathname === '/dashboard/instances' ? styles.linkActive : styles.link}>
                  Instances
                </Link>
              </>
            )}
            <Link href="/dashboard/dns/records" className={pathname.startsWith('/dashboard/dns') ? styles.linkActive : styles.link}>
              DNS
            </Link>
            <Link href="/dashboard/auto-update" className={pathname.startsWith('/dashboard/auto-update') ? styles.linkActive : styles.link}>
              Auto-Update
            </Link>
            {!isViewer && (
              <Link href="/dashboard/billing" className={pathname.startsWith('/dashboard/billing') ? styles.linkActive : styles.link}>
                Billing
              </Link>
            )}
            {!isViewer && (
              <Link href="/dashboard/settings" className={pathname.startsWith('/dashboard/settings') ? styles.linkActive : styles.link}>
                Settings
              </Link>
            )}
          </div>
          <div className={styles.navRight}>
            <ThemeToggle />
            {isViewer && (
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-muted)', background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', border: '0.0625rem solid color-mix(in srgb, var(--color-text) 12%, transparent)', borderRadius: '0.25rem', padding: '0.125rem 0.4375rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Viewer
              </span>
            )}
            <span className={styles.userEmail}>{user?.email}</span>
            <button className="btn-ghost" onClick={logout} style={{ padding: '0.3125rem 0.75rem' }}>
              Sign out
            </button>
          </div>
        </nav>
        <main className={styles.main} id="main-content">{children}</main>
      </div>
    </ToastProvider>
  );
}
