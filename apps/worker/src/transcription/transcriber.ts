/**
 * Speech-to-text seam (Phase 8). The worker transcribes uploaded recordings
 * through a pluggable `Transcriber`. Locally we run a deterministic stub so the
 * whole pipeline — upload → transcribe → segments → to-task/to-invoice — is
 * exercisable and testable without a paid STT provider. Phase 9 swaps in a real
 * provider (Whisper/Deepgram/…) behind the same interface; nothing else changes.
 */

export interface TranscriptSegmentResult {
  /** Milliseconds from the start of the audio. */
  startMs: number;
  endMs: number;
  /** Diarization label when the provider offers it; null otherwise. */
  speaker: string | null;
  text: string;
}

export interface TranscriptionResult {
  /** Full transcript text (segments concatenated). */
  text: string;
  /** BCP-47 language actually transcribed (detected or echoed from the hint). */
  language: string;
  segments: TranscriptSegmentResult[];
}

export interface TranscriptionInput {
  /** The audio bytes fetched from object storage. */
  audio: Buffer;
  contentType: string;
  /** BCP-47 language hint; providers may auto-detect and ignore this. */
  language?: string;
  /** Human hint (e.g. the recording title). Real STT ignores it; the local
   *  stub folds it into its deterministic output for readable demos/tests. */
  hint?: string;
  /** Best-known duration, used by the stub to lay out segment timestamps. */
  durationSeconds?: number | null;
}

export interface Transcriber {
  /** Stable identifier recorded alongside results (e.g. 'stub', 'whisper-1'). */
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
