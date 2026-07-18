import type { FastifyInstance } from 'fastify';
import { registerComplianceRoutes } from './routes.js';

/**
 * Phase 9 — Compliance hardening. GDPR data-portability export (async bundle to
 * object storage), per-org data-retention policy, and irreversible organization
 * erasure (right-to-be-forgotten) gated on OWNER + a typed slug confirmation.
 */
export function registerComplianceModuleRoutes(app: FastifyInstance): void {
  registerComplianceRoutes(app);
}
