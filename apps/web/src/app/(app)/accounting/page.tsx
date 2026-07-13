'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageSpinner } from '@/components/data-states';

export default function AccountingIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/accounting/vouchers');
  }, [router]);
  return <PageSpinner />;
}
