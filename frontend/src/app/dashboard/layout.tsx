'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearAuth } from '@/lib/auth';
import { ToastProvider } from '@/lib/toast';
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
    clearAuth();
    router.replace('/login');
  }

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  useEffect(() => { setUser(getUser()); }, []);

  return (
    <ToastProvider>
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
            <Link href="/dashboard" className={pathname === '/dashboard' ? styles.linkActive : styles.link}>
              Dashboard
            </Link>
            <Link href="/dashboard/instances" className={pathname === '/dashboard/instances' ? styles.linkActive : styles.link}>
              Instances
            </Link>
            <Link href="/dashboard/dns/records" className={pathname.startsWith('/dashboard/dns') ? styles.linkActive : styles.link}>
              DNS
            </Link>
            <Link href="/dashboard/auto-update" className={pathname.startsWith('/dashboard/auto-update') ? styles.linkActive : styles.link}>
              Auto-Update
            </Link>
            <Link href="/dashboard/billing" className={pathname.startsWith('/dashboard/billing') ? styles.linkActive : styles.link}>
              Billing
            </Link>
            <Link href="/dashboard/settings" className={pathname.startsWith('/dashboard/settings') ? styles.linkActive : styles.link}>
              Settings
            </Link>
          </div>
          <div className={styles.navRight}>
            <span className={styles.userEmail}>{user?.email}</span>
            <button className="btn-ghost" onClick={logout} style={{ padding: '5px 12px' }}>
              Sign out
            </button>
          </div>
        </nav>
        <main className={styles.main}>{children}</main>
      </div>
    </ToastProvider>
  );
}
