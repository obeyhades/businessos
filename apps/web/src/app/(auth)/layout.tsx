'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6 text-2xl font-semibold tracking-tight">{t('appName')}</div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
