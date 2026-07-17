import type { FastifyInstance } from 'fastify';
import { registerRecordingRoutes } from './routes.js';

/**
 * Phase 8 — Telephony / voice notes. Uploaded voice-note audio (stored in
 * object storage) and manual call logs live in one Recording model. Audio is
 * transcribed asynchronously by the worker through a pluggable STT seam, and a
 * recording can be turned into a task or a DRAFT invoice, wiring voice capture
 * into the rest of the platform.
 */
export function registerRecordingModuleRoutes(app: FastifyInstance): void {
  registerRecordingRoutes(app);
}
