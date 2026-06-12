'use client';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
}

/** Marker cookie so Next.js middleware can gate /dashboard before render.
 * Authorization itself still happens server-side via the Bearer token. */
const SESSION_COOKIE = 'opsatlas_session';

export function saveAuth(token: string, user: { id: string; email: string; role?: string }) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify({ ...user, role: user.role ?? 'admin' }));
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_COOKIE}=1; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax${secure}`;
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return { id: u.id, email: u.email, role: u.role ?? 'admin' };
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('token');
}

export function isAdmin(): boolean {
  return getUser()?.role === 'admin';
}
