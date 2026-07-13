'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorState, PageSpinner } from '@/components/data-states';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, useSession } from '@/lib/session';

/** Entry point: route to the right place based on session state. */
export default function RootPage() {
  const router = useRouter();
  const { data: session, isPending, isError, error, refetch } = useSession();
  const errorMessage = useApiErrorMessage();

  useEffect(() => {
    if (isPending || isError) return;
    if (session === null) {
      router.replace('/login');
    } else if (!activeMembership(session)) {
      router.replace('/onboarding');
    } else {
      router.replace('/dashboard');
    }
  }, [session, isPending, isError, router]);

  if (isError) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }
  return <PageSpinner />;
}
