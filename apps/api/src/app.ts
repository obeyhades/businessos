import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import type { PrismaClient } from '@businessos/db';
import { MAX_ATTACHMENT_BYTES } from '@businessos/types';
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
import { createObjectStorage, type ObjectStorage } from './lib/storage.js';
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
import { registerCustomerRoutes } from './modules/customers/routes.js';
import { registerContactRoutes } from './modules/contacts/routes.js';
import { registerProjectRoutes } from './modules/projects/routes.js';
import { registerTaskRoutes } from './modules/tasks/routes.js';
import { registerCommentRoutes } from './modules/comments/routes.js';
import { registerAttachmentRoutes } from './modules/attachments/routes.js';
import { registerActivityRoutes } from './modules/activity/routes.js';
import { registerSearchRoutes } from './modules/search/routes.js';
import { registerEmployeeRoutes } from './modules/employees/routes.js';
import { registerEmployeeNoteRoutes } from './modules/employee-notes/routes.js';
import { registerCertificationRoutes } from './modules/certifications/routes.js';
import { registerAbsenceRoutes } from './modules/absences/routes.js';
import { registerEmployeeDocumentRoutes } from './modules/employee-documents/routes.js';
import { registerOnboardingTemplateRoutes } from './modules/onboarding-templates/routes.js';
import { registerProductRoutes } from './modules/products/routes.js';
import { registerQuoteRoutes } from './modules/quotes/routes.js';
import { registerInvoiceRoutes } from './modules/invoices/routes.js';
import { registerPaymentRoutes } from './modules/payments/routes.js';
import { registerCreditNoteRoutes } from './modules/credit-notes/routes.js';
import { registerAccountingRoutes } from './modules/accounting/index.js';
import { registerCalendarModuleRoutes } from './modules/calendar/index.js';
import { registerEmailModuleRoutes } from './modules/email/index.js';
import { registerRecordingModuleRoutes } from './modules/recordings/index.js';
import { registerIntegrationModuleRoutes } from './modules/integrations/index.js';
import { registerComplianceModuleRoutes } from './modules/compliance/index.js';

export interface BuildAppOptions {
  config: ApiConfig;
  prisma: PrismaClient;
  /** Injected in tests; defaults to a real ObjectStorage from config. */
  storage?: ObjectStorage;
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

  // Tolerate an empty body on JSON requests (e.g. action POSTs like /finalize
  // that a client may send with content-type: application/json and no body).
  // The default parser throws on '' → an opaque 500; this yields undefined so
  // the route's schema (or lack of one) decides the outcome.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      (error as { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  app.decorate('prisma', options.prisma);
  app.decorate('config', options.config);
  app.decorate('storage', options.storage ?? createObjectStorage(options.config));

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

  await app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    // Truncate oversized uploads instead of throwing, so the attachment route's
    // own guard reports a clean 400 file_too_large (a thrown 413 would surface
    // as a generic 500 through the error handler).
    throwFileSizeLimit: false,
  });

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
  // Phase 2
  registerCustomerRoutes(app);
  registerContactRoutes(app);
  registerProjectRoutes(app);
  registerTaskRoutes(app);
  registerCommentRoutes(app);
  registerAttachmentRoutes(app);
  registerActivityRoutes(app);
  registerSearchRoutes(app);
  // Phase 3
  registerEmployeeRoutes(app);
  registerEmployeeNoteRoutes(app);
  registerCertificationRoutes(app);
  registerAbsenceRoutes(app);
  registerEmployeeDocumentRoutes(app);
  registerOnboardingTemplateRoutes(app);
  // Phase 4
  registerProductRoutes(app);
  registerQuoteRoutes(app);
  registerInvoiceRoutes(app);
  registerPaymentRoutes(app);
  registerCreditNoteRoutes(app);
  // Phase 5
  registerAccountingRoutes(app);
  // Phase 6
  registerCalendarModuleRoutes(app);
  // Phase 7
  registerEmailModuleRoutes(app);
  // Phase 8
  registerRecordingModuleRoutes(app);
  // Phase 9
  registerIntegrationModuleRoutes(app);
  registerComplianceModuleRoutes(app);

  app.addHook('onClose', async () => {
    await options.prisma.$disconnect();
  });

  return app;
}
