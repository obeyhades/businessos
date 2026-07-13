import nodemailer, { type Transporter } from 'nodemailer';
import type { ObjectStorage } from '@businessos/storage';
import type { EmailSendPayload } from '@businessos/types';
import type { WorkerEnv } from '../env.js';

export function createMailTransport(env: WorkerEnv): Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Mailpit locally; real providers arrive in Phase 9 behind this same interface.
    secure: false,
  });
}

export async function sendEmail(
  transport: Transporter,
  from: string,
  payload: EmailSendPayload,
  storage: ObjectStorage,
): Promise<void> {
  // Fetch the attachment (e.g. invoice PDF) from object storage if present.
  const attachments = payload.attachment
    ? [
        {
          filename: payload.attachment.fileName,
          content: await storage.get(payload.attachment.storageKey),
          contentType: payload.attachment.contentType,
        },
      ]
    : undefined;

  await transport.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    attachments,
  });
}
