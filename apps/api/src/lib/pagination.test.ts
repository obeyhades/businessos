import { describe, expect, it } from 'vitest';
import { toPaginated, toSkipTake } from './pagination.js';

describe('toSkipTake', () => {
  it('page 1 starts at offset 0', () => {
    expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  });

  it('computes the offset from page and pageSize', () => {
    expect(toSkipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(toSkipTake({ page: 100, pageSize: 1 })).toEqual({ skip: 99, take: 1 });
  });
});

describe('toPaginated', () => {
  it('echoes page metadata and totals', () => {
    const result = toPaginated(['a', 'b'], 42, { page: 2, pageSize: 2 });
    expect(result).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 2,
      totalItems: 42,
      totalPages: 21,
    });
  });

  it('rounds totalPages up for partial pages', () => {
    expect(toPaginated([], 101, { page: 1, pageSize: 25 }).totalPages).toBe(5);
    expect(toPaginated([], 100, { page: 1, pageSize: 25 }).totalPages).toBe(4);
    expect(toPaginated([], 1, { page: 1, pageSize: 25 }).totalPages).toBe(1);
  });

  it('reports at least one page even with zero items', () => {
    expect(toPaginated([], 0, { page: 1, pageSize: 25 }).totalPages).toBe(1);
  });
});
