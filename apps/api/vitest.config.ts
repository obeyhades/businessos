import { defineConfig } from 'vitest/config';

// Unit tests only — integration specs live under test/integration and run
// through vitest.integration.config.ts against a real Postgres.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
