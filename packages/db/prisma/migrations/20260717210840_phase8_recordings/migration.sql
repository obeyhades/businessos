-- CreateEnum
CREATE TYPE "RecordingSource" AS ENUM ('VOICE_NOTE', 'CALL');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('NONE', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "recordings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source" "RecordingSource" NOT NULL DEFAULT 'VOICE_NOTE',
    "title" TEXT NOT NULL,
    "storage_key" TEXT,
    "content_type" TEXT,
    "duration_seconds" INTEGER,
    "size_bytes" INTEGER,
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "direction" "CallDirection",
    "from_number" TEXT,
    "to_number" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "transcript_status" "TranscriptStatus" NOT NULL DEFAULT 'NONE',
    "transcript_text" TEXT,
    "transcript_language" TEXT,
    "transcript_error" TEXT,
    "customer_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "speaker" TEXT,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recordings_storage_key_key" ON "recordings"("storage_key");

-- CreateIndex
CREATE INDEX "recordings_organization_id_source_occurred_at_idx" ON "recordings"("organization_id", "source", "occurred_at");

-- CreateIndex
CREATE INDEX "recordings_organization_id_customer_id_idx" ON "recordings"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "recordings_organization_id_status_idx" ON "recordings"("organization_id", "status");

-- CreateIndex
CREATE INDEX "transcript_segments_recording_id_sort_order_idx" ON "transcript_segments"("recording_id", "sort_order");

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
