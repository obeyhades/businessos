import { defineConfig } from 'vitest/config';

// Integration tests hit the businessos_test Postgres database and share it,
// so spec files must not run in parallel.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
