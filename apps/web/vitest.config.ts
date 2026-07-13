import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No unit tests in apps/web yet; keep `pnpm test` green in the pipeline.
    passWithNoTests: true,
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
