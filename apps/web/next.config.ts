import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@businessos/ui',
    '@businessos/types',
    '@businessos/api-client',
    '@businessos/config',
  ],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
