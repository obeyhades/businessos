-- CreateEnum
CREATE TYPE "EmailAccountType" AS ENUM ('SHARED', 'PERSONAL');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "EmailFolder" AS ENUM ('INBOX', 'ARCHIVE', 'TRASH');

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "display_name" TEXT,
    "type" "EmailAccountType" NOT NULL DEFAULT 'SHARED',
    "owner_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "folder" "EmailFolder" NOT NULL DEFAULT 'INBOX',
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL,
    "customer_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "message_id" TEXT,
    "in_reply_to" TEXT,
    "references" TEXT[],
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_labels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_thread_labels" (
    "organization_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "email_thread_labels_pkey" PRIMARY KEY ("thread_id","label_id")
);

-- CreateIndex
CREATE INDEX "email_accounts_organization_id_type_idx" ON "email_accounts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_organization_id_address_key" ON "email_accounts"("organization_id", "address");

-- CreateIndex
CREATE INDEX "email_threads_organization_id_account_id_folder_last_messag_idx" ON "email_threads"("organization_id", "account_id", "folder", "last_message_at");

-- CreateIndex
CREATE INDEX "email_threads_organization_id_customer_id_idx" ON "email_threads"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_thread_id_created_at_idx" ON "email_messages"("organization_id", "thread_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_message_id_idx" ON "email_messages"("organization_id", "message_id");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_status_idx" ON "email_messages"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "email_attachments_storage_key_key" ON "email_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "email_attachments_organization_id_message_id_idx" ON "email_attachments"("organization_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_labels_organization_id_name_key" ON "email_labels"("organization_id", "name");

-- CreateIndex
CREATE INDEX "email_thread_labels_label_id_idx" ON "email_thread_labels"("label_id");

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_labels" ADD CONSTRAINT "email_labels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_thread_labels" ADD CONSTRAINT "email_thread_labels_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_thread_labels" ADD CONSTRAINT "email_thread_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "email_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
