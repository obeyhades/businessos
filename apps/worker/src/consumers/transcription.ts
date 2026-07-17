import { TRANSCRIPTION_QUEUE, outboxEnvelopeSchema } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { ObjectStorage } from '@businessos/storage';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from '../amqp.js';
import type { Transcriber } from '../transcription/transcriber.js';

const CONSUMER_NAME = 'recording.transcribe';

interface TranscriptionConsumerDeps {
  prisma: PrismaClient;
  channel: AmqpConfirmChannel;
  storage: ObjectStorage;
  transcriber: Transcriber;
  logger: Logger;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type TranscribeOutcome = 'transcribed' | 'failed' | 'missing' | 'no-audio';

/**
 * Transcribes one recording. Self-contained error handling: a storage/STT
 * failure flips the recording to FAILED and returns 'failed' rather than
 * throwing, so the message is still acked (no infinite retry — the user can
 * re-request transcription, which enqueues a fresh message). The success write
 * is transactional and rewrites segments from scratch, making redelivery of the
 * same message idempotent.
 */
async function transcribeRecording(
  deps: Omit<TranscriptionConsumerDeps, 'channel'>,
  organizationId: string,
  recordingId: string,
): Promise<TranscribeOutcome> {
  const { prisma, storage, transcriber, logger } = deps;
  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, organizationId },
  });
  if (!recording) return 'missing';
  if (!recording.storageKey) return 'no-audio';

  await prisma.recording.update({
    where: { id: recording.id },
    data: { status: 'TRANSCRIBING' },
  });

  let result;
  try {
    const audio = await storage.get(recording.storageKey);
    result = await transcriber.transcribe({
      audio,
      contentType: recording.contentType ?? 'application/octet-stream',
      hint: recording.title,
      durationSeconds: recording.durationSeconds,
    });
  } catch (err) {
    await prisma.recording.update({
      where: { id: recording.id },
      data: {
        status: 'FAILED',
        transcriptStatus: 'FAILED',
        transcriptError: err instanceof Error ? err.message.slice(0, 500) : String(err),
      },
    });
    await prisma.auditLog
      .create({
        data: {
          organizationId,
          action: 'recording.transcription_failed',
          entityType: 'recording',
          entityId: recording.id,
          metadata: { transcriber: transcriber.name },
        },
      })
      .catch((auditErr) => logger.error({ err: auditErr }, 'failed to record transcription audit'));
    return 'failed';
  }

  await prisma.$transaction(async (tx) => {
    // Rewrite segments so redelivery/re-transcription is idempotent.
    await tx.transcriptSegment.deleteMany({ where: { recordingId: recording.id } });
    await tx.recording.update({
      where: { id: recording.id },
      data: {
        status: 'TRANSCRIBED',
        transcriptStatus: 'COMPLETED',
        transcriptText: result.text,
        transcriptLanguage: result.language,
        transcriptError: null,
        segments: {
          create: result.segments.map((s, i) => ({
            organizationId,
            startMs: s.startMs,
            endMs: s.endMs,
            speaker: s.speaker,
            text: s.text,
            sortOrder: i,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        action: 'recording.transcribed',
        entityType: 'recording',
        entityId: recording.id,
        metadata: { transcriber: transcriber.name, segmentCount: result.segments.length },
      },
    });
    if (recording.customerId || recording.projectId || recording.taskId) {
      await tx.activity.create({
        data: {
          organizationId,
          type: 'recording.transcribed',
          customerId: recording.customerId,
          projectId: recording.projectId,
          taskId: recording.taskId,
          metadata: { title: recording.title },
        },
      });
    }
  });
  return 'transcribed';
}

/**
 * recording.transcribe consumer. Reacts to recording.uploaded by transcribing
 * the audio through the pluggable Transcriber. At-least-once with a
 * processed-message idempotency ledger; hard failures are recorded to
 * failed_jobs and acked (dropped) so a bad message can't loop.
 */
export async function startTranscriptionConsumer(deps: TranscriptionConsumerDeps): Promise<void> {
  const { prisma, channel, logger } = deps;

  await channel.prefetch(3);
  await channel.consume(TRANSCRIPTION_QUEUE, (message) => {
    if (!message) return;
    void (async () => {
      const rawContent = message.content.toString();
      let envelopeId: string | undefined;
      try {
        const envelope = outboxEnvelopeSchema.parse(JSON.parse(rawContent));
        envelopeId = envelope.id;

        const already = await prisma.processedMessage.findUnique({
          where: { messageId_consumer: { messageId: envelope.id, consumer: CONSUMER_NAME } },
        });
        if (already) {
          channel.ack(message);
          return;
        }

        let outcome: TranscribeOutcome | 'ignored' = 'ignored';
        if (envelope.type === 'recording.uploaded') {
          const payload = envelope.payload as { recordingId?: string; organizationId?: string };
          if (payload.recordingId && payload.organizationId) {
            outcome = await transcribeRecording(
              { prisma, storage: deps.storage, transcriber: deps.transcriber, logger },
              payload.organizationId,
              payload.recordingId,
            );
          }
        }

        try {
          await prisma.processedMessage.create({
            data: { messageId: envelope.id, consumer: CONSUMER_NAME },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }

        logger.info({ messageId: envelope.id, type: envelope.type, outcome }, 'transcription processed');
        channel.ack(message);
      } catch (error) {
        logger.error({ err: error, messageId: envelopeId }, 'transcription failed');
        await prisma.failedJob
          .create({
            data: {
              queue: TRANSCRIPTION_QUEUE,
              messageType: 'recording.transcribe',
              payload: { raw: rawContent } as Prisma.InputJsonValue,
              error: error instanceof Error ? error.message.slice(0, 2000) : String(error),
              attempts: 1,
            },
          })
          .catch((dbError) => logger.error({ err: dbError }, 'failed to record failed job'));
        channel.ack(message);
      }
    })();
  });

  logger.info({ queue: TRANSCRIPTION_QUEUE }, 'transcription consumer started');
}
