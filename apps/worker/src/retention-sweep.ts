import type { PrismaClient } from '@businessos/db';
import type { ObjectStorage } from '@businessos/storage';
import type { Logger } from 'pino';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enforces per-org data-retention policies: deletes rows older than each
 * configured window. A null window means "keep indefinitely" and is skipped.
 * Recording audio objects are purged from storage before the rows go, so a
 * retention delete doesn't orphan blobs.
 */
export function startRetentionSweep(
  prisma: PrismaClient,
  storage: ObjectStorage,
  intervalSeconds: number,
  logger: Logger,
): { stop: () => void } {
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  async function sweep(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // Global pass (not policy-gated): a GDPR export is a full-org data dump
      // with a fixed 7-day download TTL. Once expired, purge the blob and clear
      // the key so the most sensitive artifact doesn't linger in storage.
      const expiredExports = await prisma.dataExportJob.findMany({
        where: { expiresAt: { lt: new Date() }, storageKey: { not: null } },
        select: { id: true, storageKey: true },
      });
      for (const job of expiredExports) {
        if (!job.storageKey) continue;
        await storage
          .delete(job.storageKey)
          .catch((err) => logger.warn({ err, key: job.storageKey }, 'export purge failed'));
        await prisma.dataExportJob.update({ where: { id: job.id }, data: { storageKey: null } });
      }
      if (expiredExports.length > 0) {
        logger.info({ count: expiredExports.length }, 'retention: expired exports purged');
      }

      const policies = await prisma.retentionPolicy.findMany();
      for (const policy of policies) {
        const org = policy.organizationId;
        const cutoff = (days: number): Date => new Date(Date.now() - days * DAY_MS);

        if (policy.recordingsDays) {
          const before = cutoff(policy.recordingsDays);
          const doomed = await prisma.recording.findMany({
            where: { organizationId: org, createdAt: { lt: before }, storageKey: { not: null } },
            select: { storageKey: true },
          });
          const { count } = await prisma.recording.deleteMany({
            where: { organizationId: org, createdAt: { lt: before } },
          });
          // Purge audio after the rows are gone (best-effort).
          await Promise.all(
            doomed.map((r) =>
              r.storageKey
                ? storage
                    .delete(r.storageKey)
                    .catch((err) => logger.warn({ err, key: r.storageKey }, 'retention purge failed'))
                : Promise.resolve(),
            ),
          );
          if (count > 0) logger.info({ org, count }, 'retention: recordings deleted');
        }

        if (policy.auditLogsDays) {
          const { count } = await prisma.auditLog.deleteMany({
            where: { organizationId: org, createdAt: { lt: cutoff(policy.auditLogsDays) } },
          });
          if (count > 0) logger.info({ org, count }, 'retention: audit logs deleted');
        }

        if (policy.activitiesDays) {
          const { count } = await prisma.activity.deleteMany({
            where: { organizationId: org, createdAt: { lt: cutoff(policy.activitiesDays) } },
          });
          if (count > 0) logger.info({ org, count }, 'retention: activities deleted');
        }

        if (policy.webhookDeliveriesDays) {
          const { count } = await prisma.webhookDelivery.deleteMany({
            where: {
              organizationId: org,
              createdAt: { lt: cutoff(policy.webhookDeliveriesDays) },
            },
          });
          if (count > 0) logger.info({ org, count }, 'retention: webhook deliveries deleted');
        }
      }
    } catch (err) {
      logger.error({ err }, 'retention sweep failed');
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
    }
  }

  timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
