import { z } from 'zod';

export const commonEnvSchema = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
} satisfies z.ZodRawShape;

/**
 * Validates process.env against the given shape and aborts the process with a
 * readable report when validation fails. Apps must call this once at startup
 * so misconfiguration is caught before any request or job is handled.
 */
export function parseEnv<TShape extends z.ZodRawShape>(
  shape: TShape,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<TShape>> {
  const result = z.object(shape).safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Intentionally console.error: the logger may itself depend on env config.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  return result.data;
}
