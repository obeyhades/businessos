import { describe, expect, it } from 'vitest';
import { StubTranscriber } from './stub.js';
import type { TranscriptionInput } from './transcriber.js';

const transcriber = new StubTranscriber();

/** A transcription input with sensible defaults; override per test. */
function input(overrides: Partial<TranscriptionInput> = {}): TranscriptionInput {
  return {
    audio: Buffer.from('deterministic-audio-bytes'),
    contentType: 'audio/webm',
    ...overrides,
  };
}

describe('StubTranscriber', () => {
  it('names itself so results can record their provenance', () => {
    expect(transcriber.name).toBe('stub');
  });

  it('is deterministic — identical audio yields identical text and segments', async () => {
    const audio = Buffer.from('the-same-audio');
    const a = await transcriber.transcribe(input({ audio }));
    const b = await transcriber.transcribe(input({ audio }));
    expect(a.text).toBe(b.text);
    expect(a.language).toBe(b.language);
    expect(a.segments).toEqual(b.segments);
  });

  it('produces different transcripts for different audio', async () => {
    const a = await transcriber.transcribe(input({ audio: Buffer.from('alpha-audio') }));
    const b = await transcriber.transcribe(input({ audio: Buffer.from('beta-audio') }));
    expect(a.text).not.toBe(b.text);
  });

  it('emits between 2 and 4 segments', async () => {
    // Sweep several distinct inputs so the seeded count is exercised across its range.
    for (let i = 0; i < 25; i += 1) {
      const result = await transcriber.transcribe(input({ audio: Buffer.from(`audio-${i}`) }));
      expect(result.segments.length).toBeGreaterThanOrEqual(2);
      expect(result.segments.length).toBeLessThanOrEqual(4);
    }
  });

  it('lays out monotonic, contiguous timestamps that end at the derived total', async () => {
    const durationSeconds = 30;
    const result = await transcriber.transcribe(input({ durationSeconds }));
    const totalMs = durationSeconds * 1000;

    expect(result.segments[0]!.startMs).toBe(0);
    for (let i = 0; i < result.segments.length; i += 1) {
      const seg = result.segments[i]!;
      // Each segment has a positive duration.
      expect(seg.endMs).toBeGreaterThan(seg.startMs);
      if (i > 0) {
        const prev = result.segments[i - 1]!;
        // Monotonic and contiguous: this segment starts where the previous ended.
        expect(seg.startMs).toBe(prev.endMs);
        expect(seg.startMs).toBeGreaterThan(prev.startMs);
      }
    }
    // The final segment ends exactly at the derived total.
    expect(result.segments.at(-1)!.endMs).toBe(totalMs);
  });

  it('derives a minimum 4s total when no duration is supplied', async () => {
    const result = await transcriber.transcribe(input({ durationSeconds: null }));
    expect(result.segments.at(-1)!.endMs).toBeGreaterThanOrEqual(4000);
  });

  it('folds the hint into the first segment', async () => {
    const result = await transcriber.transcribe(input({ hint: 'Roof inspection at Storgatan 4' }));
    expect(result.segments[0]!.text).toBe('Voice note: Roof inspection at Storgatan 4.');
    // The full text is the segments concatenated, so it leads with the hint.
    expect(result.text.startsWith('Voice note: Roof inspection at Storgatan 4.')).toBe(true);
  });

  it('trims a whitespace-only hint away rather than emitting an empty lead', async () => {
    const result = await transcriber.transcribe(input({ hint: '   ' }));
    expect(result.segments[0]!.text.startsWith('Voice note:')).toBe(false);
  });

  it('echoes the language hint and defaults to en', async () => {
    expect((await transcriber.transcribe(input({ language: 'sv' }))).language).toBe('sv');
    expect((await transcriber.transcribe(input())).language).toBe('en');
  });

  it('concatenates segment text into the full transcript', async () => {
    const result = await transcriber.transcribe(input({ audio: Buffer.from('concat-check') }));
    expect(result.text).toBe(result.segments.map((s) => s.text).join(' '));
  });
});
