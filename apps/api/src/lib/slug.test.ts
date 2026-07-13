import { describe, expect, it } from 'vitest';
import { slugify, slugWithSuffix } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates plain names', () => {
    expect(slugify('Demo Hantverk AB')).toBe('demo-hantverk-ab');
  });

  it('transliterates Swedish characters', () => {
    expect(slugify('Åkeri Öst')).toBe('akeri-ost');
  });

  it('strips combining marks from other accented letters', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('falls back to "org" for emptyish input', () => {
    expect(slugify('')).toBe('org');
    expect(slugify('   ')).toBe('org');
    expect(slugify('!!!')).toBe('org');
  });

  it('collapses repeated separators and trims edge hyphens', () => {
    expect(slugify('  Foo   &   Bar!  ')).toBe('foo-bar');
  });
});

describe('slugWithSuffix', () => {
  it('appends a 6-hex-character random suffix', () => {
    const slug = slugWithSuffix('Demo Hantverk AB');
    expect(slug).toMatch(/^demo-hantverk-ab-[0-9a-f]{6}$/);
  });

  it('uses the fallback base for emptyish input', () => {
    expect(slugWithSuffix('')).toMatch(/^org-[0-9a-f]{6}$/);
  });
});
