import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Puts the instructor pages and research data behind a password, so testers on
 * the same network can submit and answer but can't open other students' work.
 *
 * The password comes from CODELAPSE_INSTRUCTOR_PASSWORD (`npm run demo` creates
 * one and prints it). Without it, nothing is locked: fine on your own machine,
 * not on a shared network. The browser asks for it once; any user name works.
 */
export function proxy(request: NextRequest): NextResponse {
  const password = process.env.CODELAPSE_INSTRUCTOR_PASSWORD;
  if (!password || !needsInstructor(request)) {
    return NextResponse.next();
  }
  if (suppliedPassword(request.headers.get('authorization')) === password) {
    return NextResponse.next();
  }
  return new NextResponse('Instructor password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="CodeLapse instructor", charset="UTF-8"' }
  });
}

/** Instructor-only: everything under /instructor, research data, ratings, and re-running the AI. */
export function needsInstructor(request: Pick<NextRequest, 'method' | 'nextUrl'>): boolean {
  const path = request.nextUrl.pathname;
  if (path === '/instructor' || path.startsWith('/instructor/') || path.startsWith('/api/research/')) {
    return true;
  }
  // Students read their questions (GET); only instructors ask for them to be written again (POST).
  if (/^\/api\/submissions\/[^/]+\/questions$/.test(path)) {
    return request.method !== 'GET';
  }
  return /^\/api\/submissions\/[^/]+\/(feedback|evaluation)$/.test(path);
}

/** The password from a Basic authorization header, or null. */
export function suppliedPassword(header: string | null): string | null {
  if (!header?.startsWith('Basic ')) {
    return null;
  }
  try {
    const decoded = atob(header.slice('Basic '.length).trim());
    const colon = decoded.indexOf(':');
    return colon === -1 ? null : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

export const config = {
  matcher: ['/instructor', '/instructor/:path*', '/api/research/:path*', '/api/submissions/:id/:action']
};
