-- Replace the non-unique (recording_id, sort_order) index with a UNIQUE index.
-- This is a concurrency backstop: two racing transcription runs of the same
-- recording can no longer both insert a full segment set, so transcript
-- segments can never be duplicated. Serial re-transcription (deleteMany then
-- recreate within one transaction) is unaffected.
DROP INDEX "transcript_segments_recording_id_sort_order_idx";
CREATE UNIQUE INDEX "transcript_segments_recording_id_sort_order_key" ON "transcript_segments"("recording_id", "sort_order");
