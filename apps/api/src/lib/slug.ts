import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    // Swedish characters first so "Åkeri" → "akeri", not "keri".
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'org';
}

export function slugWithSuffix(input: string): string {
  return `${slugify(input)}-${randomBytes(3).toString('hex')}`;
}
