'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiError } from './api';

/** Error codes with a curated translation; anything else falls back to the server message. */
const TRANSLATED_ERROR_CODES = new Set([
  'unauthorized',
  'invalid_credentials',
  'forbidden',
  'no_active_organization',
  'not_found',
  'csrf_rejected',
  'rate_limited',
  'validation_error',
  'internal_error',
  'email_taken',
  'invalid_password',
  'invalid_reset_token',
  'invitation_pending',
  'already_member',
  'cannot_change_own_role',
  'cannot_remove_self',
  'unbalanced',
  'period_locked',
  'already_posted',
  'not_draft',
  'not_posted',
  'account_in_use',
  'code_taken',
]);

export function useApiErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (TRANSLATED_ERROR_CODES.has(error.code)) return t(error.code);
        return error.message;
      }
      return t('unknown');
    },
    [t],
  );
}
