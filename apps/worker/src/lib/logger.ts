import { pino, type Logger } from 'pino';
import type { WorkerEnv } from '../env.js';

export function buildLogger(env: WorkerEnv): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ['*.password', '*.token', '*.text', '*.to', 'payload.text', 'payload.to'],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
