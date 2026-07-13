import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  // CJS output: bundled CJS transitive deps (e.g. dotenv) break under an ESM
  // bundle ("Dynamic require of fs is not supported"). Node runs the .cjs fine.
  format: ['cjs'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Workspace packages are TS-source-only; bundle them. Everything else
  // (including @prisma/client with its native engine) stays external.
  noExternal: [/^@businessos\//],
});
