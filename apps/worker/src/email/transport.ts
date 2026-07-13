import nodemailer, { type Transporter } from 'nodemailer';
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
): Promise<void> {
  await transport.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  });
}
