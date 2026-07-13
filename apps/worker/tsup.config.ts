import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  // CJS for the same reason as apps/api: bundled CJS deps break in ESM bundles.
  format: ['cjs'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@businessos\//],
});
