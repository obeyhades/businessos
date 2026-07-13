-- Phase 5 hardening (raw SQL — not expressible in the Prisma schema).

-- Atomic idempotency for auto-generated draft vouchers: at most one voucher per
-- (organization, source document). MANUAL/opening vouchers (source_type NULL)
-- are exempt. Makes the worker's (sourceType, sourceId) dedup race-proof.
CREATE UNIQUE INDEX "vouchers_org_source_unique"
  ON "vouchers" ("organization_id", "source_type", "source_id")
  WHERE "source_type" IS NOT NULL;

-- Prevent overlapping fiscal periods within an organization, so a voucher date
-- can never resolve to two periods (and bypass a period lock).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "fiscal_periods"
  ADD CONSTRAINT "fiscal_periods_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  );
