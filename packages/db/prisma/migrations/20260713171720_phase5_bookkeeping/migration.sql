-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VoucherSource" AS ENUM ('MANUAL', 'INVOICE', 'PAYMENT', 'OPENING_BALANCE');

-- AlterEnum
ALTER TYPE "NumberSequenceKind" ADD VALUE 'VOUCHER';

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "VoucherSource" NOT NULL DEFAULT 'MANUAL',
    "source_type" TEXT,
    "source_id" UUID,
    "fiscal_period_id" UUID,
    "total_debit_minor" BIGINT NOT NULL DEFAULT 0,
    "total_credit_minor" BIGINT NOT NULL DEFAULT 0,
    "reverses_voucher_id" UUID,
    "reconciled_at" TIMESTAMPTZ(6),
    "posted_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "posted_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mappings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sales_account_id" UUID,
    "output_vat_account_id" UUID,
    "receivable_account_id" UUID,
    "bank_account_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_organization_id_type_idx" ON "accounts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_key" ON "accounts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organization_id_name_key" ON "fiscal_years"("organization_id", "name");

-- CreateIndex
CREATE INDEX "fiscal_periods_organization_id_start_date_idx" ON "fiscal_periods"("organization_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_reverses_voucher_id_key" ON "vouchers"("reverses_voucher_id");

-- CreateIndex
CREATE INDEX "vouchers_organization_id_status_idx" ON "vouchers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "vouchers_organization_id_date_idx" ON "vouchers"("organization_id", "date");

-- CreateIndex
CREATE INDEX "vouchers_source_type_source_id_idx" ON "vouchers"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_organization_id_number_key" ON "vouchers"("organization_id", "number");

-- CreateIndex
CREATE INDEX "voucher_lines_voucher_id_sort_order_idx" ON "voucher_lines"("voucher_id", "sort_order");

-- CreateIndex
CREATE INDEX "voucher_lines_organization_id_account_id_idx" ON "voucher_lines"("organization_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_attachments_storage_key_key" ON "voucher_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "voucher_attachments_organization_id_voucher_id_idx" ON "voucher_attachments"("organization_id", "voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_mappings_organization_id_key" ON "account_mappings"("organization_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reverses_voucher_id_fkey" FOREIGN KEY ("reverses_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_attachments" ADD CONSTRAINT "voucher_attachments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_attachments" ADD CONSTRAINT "voucher_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
