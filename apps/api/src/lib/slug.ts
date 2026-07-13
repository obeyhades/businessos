import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    // Swedish characters BEFORE NFKD — decomposition would split å into
    // a + combining ring and these classes would no longer match.
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .normalize('NFKD')
    // Drop combining marks left by decomposition (é → e etc.).
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'org';
}

export function slugWithSuffix(input: string): string {
  return `${slugify(input)}-${randomBytes(3).toString('hex')}`;
}
