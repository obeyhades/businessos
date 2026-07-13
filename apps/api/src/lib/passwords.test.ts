import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

// argon2id is deliberately slow; keep this suite to a single hash.
describe('passwords', () => {
  it('hashes with argon2id and verifies the roundtrip', async () => {
    const hash = await hashPassword('CorrectHorse42!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'CorrectHorse42!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'WrongHorse42!')).resolves.toBe(false);
  }, 30_000);

  it('treats a malformed stored hash as non-matching instead of throwing', async () => {
    await expect(verifyPassword('not-a-valid-argon2-hash', 'whatever')).resolves.toBe(false);
    await expect(verifyPassword('', 'whatever')).resolves.toBe(false);
  });
});
