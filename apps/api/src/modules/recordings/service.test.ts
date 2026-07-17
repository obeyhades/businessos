import { describe, expect, it } from 'vitest';
import { transcriptSnippet } from './service.js';

describe('transcriptSnippet', () => {
  it('returns null for null input', () => {
    expect(transcriptSnippet(null)).toBeNull();
  });

  it('returns null for empty or whitespace-only text', () => {
    expect(transcriptSnippet('')).toBeNull();
    expect(transcriptSnippet('   \n\t  ')).toBeNull();
  });

  it('collapses runs of whitespace to single spaces and trims the ends', () => {
    expect(transcriptSnippet('  Call   the\tcustomer\n\nback tomorrow.  ')).toBe(
      'Call the customer back tomorrow.',
    );
  });

  it('leaves already-clean text unchanged', () => {
    expect(transcriptSnippet('A short note.')).toBe('A short note.');
  });

  it('truncates to the default maximum length (2000)', () => {
    const long = 'a'.repeat(5000);
    const snippet = transcriptSnippet(long);
    expect(snippet).not.toBeNull();
    expect(snippet).toHaveLength(2000);
  });

  it('truncates to a caller-supplied maximum', () => {
    expect(transcriptSnippet('abcdefghij', 4)).toBe('abcd');
  });

  it('collapses whitespace before applying the length limit', () => {
    // 10 words separated by runs of spaces collapse first, then truncate.
    const text = 'one    two    three    four';
    expect(transcriptSnippet(text, 7)).toBe('one two');
  });
});
