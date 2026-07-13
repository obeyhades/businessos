import swagger from '@fastify/swagger';
import type { PrismaClient } from '@businessos/db';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { ApiConfig } from './config.js';
import { AppError } from './lib/errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { registerAuthContext } from './plugins/auth.js';
import { registerSecurity } from './plugins/security.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerAuditLogRoutes } from './modules/audit-logs/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerInvitationRoutes } from './modules/invitations/routes.js';
import { registerMeRoutes } from './modules/me/routes.js';
import { registerMemberRoutes } from './modules/members/routes.js';
import { registerOrganizationRoutes } from './modules/organizations/routes.js';

export interface BuildAppOptions {
  config: ApiConfig;
  prisma: PrismaClient;
  /** Override logging in tests (`false` to silence). */
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: options.logger ?? buildLoggerOptions(options.config),
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('prisma', options.prisma);
  app.decorate('config', options.config);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    const fastifyError = error as { validation?: unknown; statusCode?: number };
    // Zod/schema validation failures raised by the validator compiler.
    if (fastifyError.validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: fastifyError.validation,
        },
      });
    }
    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests, please slow down' },
      });
    }
    // Anything else is unexpected: log with the request id, hide internals.
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BusinessOS API',
        description: 'REST API for the BusinessOS platform',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  if (options.config.NODE_ENV !== 'production') {
    app.get('/docs/json', async (_request, reply) => reply.send(app.swagger()));
  }

  await registerSecurity(app);
  registerAuthContext(app);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerOrganizationRoutes(app);
  registerMemberRoutes(app);
  registerInvitationRoutes(app);
  registerAuditLogRoutes(app);
  registerAdminRoutes(app);

  app.addHook('onClose', async () => {
    await options.prisma.$disconnect();
  });

  return app;
}
