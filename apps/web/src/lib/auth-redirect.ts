'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { activeMembership, useSession } from './session';

/** Only allow same-app relative paths as post-auth redirect targets. */
export function safeNextPath(next: string | null): string | null {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return null;
}

/**
 * Auth pages (login/register/…) bounce already-authenticated users onwards —
 * to `next` when provided (e.g. back to an invitation), otherwise dashboard.
 */
export function useRedirectIfAuthenticated(next: string | null = null): void {
  const router = useRouter();
  const { data: session } = useSession();

  useEffect(() => {
    if (!session) return;
    const target = safeNextPath(next) ?? (activeMembership(session) ? '/dashboard' : '/onboarding');
    router.replace(target);
  }, [session, next, router]);
}
