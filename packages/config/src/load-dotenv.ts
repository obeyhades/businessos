import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

/**
 * Loads the repository-root `.env` into process.env regardless of which
 * workspace package the process was started from. Values already present
 * in the environment always win (dotenv default behaviour), so CI and
 * production overrides work without surprises.
 */
export function loadRootDotenv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      return candidate;
    }
    // Stop at the workspace root even if it has no .env yet.
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
