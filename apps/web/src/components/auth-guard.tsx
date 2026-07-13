'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ErrorState, PageSpinner } from './data-states';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, useSession } from '@/lib/session';

/**
 * Client-side route protection for the authenticated area. Redirects
 * anonymous visitors to /login and org-less sessions to /onboarding.
 */
export function AuthGuard({
  children,
  requireOrg = true,
}: {
  children: ReactNode;
  requireOrg?: boolean;
}) {
  const router = useRouter();
  const { data: session, isPending, isError, error, refetch } = useSession();
  const errorMessage = useApiErrorMessage();

  useEffect(() => {
    if (isPending || isError) return;
    if (session === null) {
      router.replace('/login');
      return;
    }
    if (requireOrg && !activeMembership(session)) {
      router.replace('/onboarding');
    }
  }, [session, isPending, isError, requireOrg, router]);

  if (isPending) return <PageSpinner />;
  if (isError) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!session || (requireOrg && !activeMembership(session))) return <PageSpinner />;
  return <>{children}</>;
}
