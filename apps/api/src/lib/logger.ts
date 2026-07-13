import type { FastifyServerOptions } from 'fastify';
import type { ApiConfig } from '../config.js';

/**
 * Structured JSON logging with sensitive-data redaction. Request bodies are
 * never logged; cookies, set-cookie and authorization headers are redacted.
 */
export function buildLoggerOptions(config: ApiConfig): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.tokenHash',
        '*.passwordHash',
        // Sensitive personnel fields (Phase 3) — never log personal identifiers.
        '*.personalIdNumber',
        '*.dateOfBirth',
        '*.homeAddress',
        '*.personalEmail',
        '*.personalPhone',
        '*.emergencyContactPhone',
      ],
      censor: '[redacted]',
    },
    ...(config.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}
