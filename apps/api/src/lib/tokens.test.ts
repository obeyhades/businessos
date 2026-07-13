import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, safeEqualHex } from './tokens.js';

describe('generateToken', () => {
  it('produces 43-character base64url strings (32 random bytes, no padding)', () => {
    for (let i = 0; i < 20; i += 1) {
      const token = generateToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('produces unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('hashToken', () => {
  it('is a stable lowercase hex SHA-256 digest', () => {
    // Known SHA-256 test vector.
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs hash differently', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('safeEqualHex', () => {
  it('returns true for equal hex strings', () => {
    const hash = hashToken('some-token');
    expect(safeEqualHex(hash, hash)).toBe(true);
  });

  it('returns false for different hex strings of equal length', () => {
    expect(safeEqualHex(hashToken('a'), hashToken('b'))).toBe(false);
  });

  it('returns false on length mismatch instead of throwing', () => {
    expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(safeEqualHex('', hashToken('a'))).toBe(false);
  });
});
