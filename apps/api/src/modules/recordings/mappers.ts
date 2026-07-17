import type { Recording, TranscriptSegment } from '@businessos/db';
import type { RecordingDto, TranscriptSegmentDto } from '@businessos/types';

export function toTranscriptSegmentDto(segment: TranscriptSegment): TranscriptSegmentDto {
  return {
    id: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    speaker: segment.speaker,
    text: segment.text,
    sortOrder: segment.sortOrder,
  };
}

/**
 * Serializes a recording. `hasAudio` is derived (never expose the storage key);
 * segments are optional so list responses can omit them and only the detail
 * endpoint pays for the join.
 */
export function toRecordingDto(
  recording: Recording,
  segments: TranscriptSegment[] = [],
): RecordingDto {
  return {
    id: recording.id,
    source: recording.source,
    title: recording.title,
    hasAudio: recording.storageKey !== null,
    contentType: recording.contentType,
    durationSeconds: recording.durationSeconds,
    sizeBytes: recording.sizeBytes,
    status: recording.status,
    direction: recording.direction,
    fromNumber: recording.fromNumber,
    toNumber: recording.toNumber,
    occurredAt: recording.occurredAt.toISOString(),
    transcriptStatus: recording.transcriptStatus,
    transcriptText: recording.transcriptText,
    transcriptLanguage: recording.transcriptLanguage,
    transcriptError: recording.transcriptError,
    customerId: recording.customerId,
    projectId: recording.projectId,
    taskId: recording.taskId,
    createdById: recording.createdById,
    segments: segments.map(toTranscriptSegmentDto),
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}
