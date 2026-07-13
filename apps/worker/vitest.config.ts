import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The worker's behaviour is exercised end-to-end (outbox → RabbitMQ →
    // Mailpit) and via the API integration suite's outbox assertions; unit
    // tests arrive with Phase 9 hardening (reconnect/backoff logic).
    passWithNoTests: true,
  },
});
