import { createServer, type Server } from 'node:http';
import type { PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import type { AmqpConnection } from './amqp.js';

/**
 * Minimal health server for the worker: /healthz (liveness) and /readyz
 * (database + RabbitMQ connectivity).
 */
export function startHealthServer(
  port: number,
  prisma: PrismaClient,
  isAmqpConnected: () => boolean,
  logger: Logger,
): Server {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.url === '/readyz') {
        const checks: Record<string, string> = {
          rabbitmq: isAmqpConnected() ? 'ok' : 'failed',
        };
        try {
          await prisma.$queryRaw`SELECT 1`;
          checks.database = 'ok';
        } catch {
          checks.database = 'failed';
        }
        const ready = Object.values(checks).every((value) => value === 'ok');
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable', checks }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
    })();
  });
  server.listen(port, '127.0.0.1', () => logger.info({ port }, 'worker health server listening'));
  return server;
}
