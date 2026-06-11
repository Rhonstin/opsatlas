'use client';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
}

export function saveAuth(token: string, user: { id: string; email: string; role?: string }) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify({ ...user, role: user.role ?? 'admin' }));
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
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
