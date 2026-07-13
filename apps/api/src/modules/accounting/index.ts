import type { FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './accounts.routes.js';
import { registerFiscalRoutes } from './fiscal.routes.js';
import { registerVoucherRoutes } from './vouchers.routes.js';
import { registerVoucherAttachmentRoutes } from './attachments.routes.js';
import { registerReportRoutes } from './reports.routes.js';

/**
 * Phase 5 — Bookkeeping support. Double-entry ledger: chart of accounts,
 * fiscal periods (lockable), vouchers (journal entries) with balance
 * enforcement + posting/immutability + reversal, reconciliation, and reports
 * (trial balance, general ledger, CSV exports). NOT reviewed for
 * accounting/tax compliance.
 */
export function registerAccountingRoutes(app: FastifyInstance): void {
  registerAccountRoutes(app);
  registerFiscalRoutes(app);
  registerVoucherRoutes(app);
  registerVoucherAttachmentRoutes(app);
  registerReportRoutes(app);
}
