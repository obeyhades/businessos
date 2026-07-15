-- Inbound idempotency: at most one message per (organization, RFC Message-ID).
-- DRAFT/composed messages have a NULL message_id and are exempt. Makes the
-- inbound webhook's dedup race-proof (raw SQL — partial unique is not
-- expressible in the Prisma schema).
CREATE UNIQUE INDEX "email_messages_org_message_id_unique"
  ON "email_messages" ("organization_id", "message_id")
  WHERE "message_id" IS NOT NULL;
