import type { FastifyInstance } from 'fastify';
import { registerIntegrationRoutes } from './routes.js';

/**
 * Phase 9 — Integrations. Org-managed webhook endpoints that receive HMAC-signed
 * deliveries of the domain events they subscribe to (the worker fans
 * `businessos.events` out to them), with a delivery log, secret rotation, a
 * synchronous ping test, and redelivery.
 */
export function registerIntegrationModuleRoutes(app: FastifyInstance): void {
  registerIntegrationRoutes(app);
}
