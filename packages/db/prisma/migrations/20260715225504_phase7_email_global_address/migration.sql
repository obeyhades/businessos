-- A mailbox address is globally unique among ACTIVE mailboxes (case-insensitive):
-- inbound routing derives exactly one tenant, and no org can claim another org's
-- address. Not expressible in the Prisma schema (partial + functional index).
CREATE UNIQUE INDEX "email_accounts_active_address_unique"
  ON "email_accounts" (lower("address"))
  WHERE "is_active" = true;
