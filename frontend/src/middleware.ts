import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Gate /dashboard before anything renders: without a session cookie the user
 * is redirected to /login. This only prevents the UI flash for anonymous
 * visitors — real authorization happens in the backend on every API call.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('opsatlas_session');

  if (!hasSession && request.nextUrl.pathname.startsWith('/dashboard')) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }

  if (hasSession && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/'],
};
