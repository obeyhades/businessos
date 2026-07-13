import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The transpiled workspace packages are source-only ESM with `.js`-suffixed
  // relative imports (NodeNext style); webpack needs this alias to map them
  // back to their .ts sources.
  experimental: {
    extensionAlias: { '.js': ['.js', '.ts', '.tsx'] },
  },
  transpilePackages: [
    '@businessos/ui',
    '@businessos/types',
    '@businessos/api-client',
    '@businessos/config',
  ],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
