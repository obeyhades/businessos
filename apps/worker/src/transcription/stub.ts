import { createHash } from 'node:crypto';
import type {
  Transcriber,
  TranscriptSegmentResult,
  TranscriptionInput,
  TranscriptionResult,
} from './transcriber.js';

/**
 * Deterministic local stand-in for a real STT provider. It does NOT actually
 * decode speech — it derives a stable, readable pseudo-transcript from a hash
 * of the audio bytes so the full pipeline (upload → transcribe → segments →
 * to-task/to-invoice) is exercisable offline and tests are reproducible.
 * Identical audio always yields the identical transcript, which also makes
 * re-transcription idempotent.
 */
const LEXICON = [
  'Following up on the site visit from earlier today.',
  'The customer asked for a revised quote by the end of the week.',
  'We need to order additional materials before we continue.',
  'Remember to book a follow-up call with the project lead.',
  'Everything is on track for the planned delivery date.',
  'There was a question about last month’s invoice.',
  'Please confirm the measurements before we place the order.',
  'The team finished the installation ahead of schedule.',
] as const;

function seedFrom(buffer: Buffer): number {
  const digest = createHash('sha256').update(buffer).digest();
  return digest.readUInt32LE(0) >>> 0;
}

/** Small deterministic PRNG (mulberry32) — no Math.random, fully seeded. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class StubTranscriber implements Transcriber {
  readonly name = 'stub';

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const rand = mulberry32(seedFrom(input.audio));
    const language = input.language ?? 'en';
    const count = 2 + Math.floor(rand() * 3); // 2..4 segments
    const totalMs = Math.max(4000, Math.round((input.durationSeconds ?? count * 4) * 1000));
    const perMs = Math.floor(totalMs / count);

    const sentences: string[] = [];
    const hint = input.hint?.trim();
    if (hint) sentences.push(`Voice note: ${hint}.`);
    while (sentences.length < count) {
      sentences.push(LEXICON[Math.floor(rand() * LEXICON.length)]!);
    }

    const segments: TranscriptSegmentResult[] = sentences.slice(0, count).map((text, i) => ({
      startMs: i * perMs,
      endMs: i === count - 1 ? totalMs : (i + 1) * perMs,
      speaker: null,
      text,
    }));

    return { text: segments.map((s) => s.text).join(' '), language, segments };
  }
}
