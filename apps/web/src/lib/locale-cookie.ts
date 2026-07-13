import type { Locale } from '@businessos/types';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * next-intl reads the locale from this cookie (src/i18n/request.ts). Setting it
 * client-side + router.refresh() re-renders the tree in the new language.
 */
export function setLocaleCookie(locale: Locale): void {
  document.cookie = `locale=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
