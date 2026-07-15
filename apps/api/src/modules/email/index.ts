import type { FastifyInstance } from 'fastify';
import { registerEmailAccountRoutes } from './accounts.routes.js';
import { registerEmailLabelRoutes } from './labels.routes.js';
import { registerEmailThreadRoutes } from './threads.routes.js';
import { registerEmailMessageRoutes } from './messages.routes.js';
import { registerEmailInboundRoutes } from './inbound.routes.js';

/**
 * Phase 7 — Email. Shared/personal mailboxes, threaded conversations,
 * compose/reply/send through the worker email pipeline, an authenticated
 * inbound-ingestion webhook (provider seam), folders/labels/star/read,
 * auto-linking of conversations to customers, and email → task.
 */
export function registerEmailModuleRoutes(app: FastifyInstance): void {
  registerEmailAccountRoutes(app);
  registerEmailLabelRoutes(app);
  registerEmailThreadRoutes(app);
  registerEmailMessageRoutes(app);
  registerEmailInboundRoutes(app);
}
