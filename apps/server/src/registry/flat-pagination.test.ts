import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { flatSelectionSchema, lookupSchema } from '@portl/contracts';

describe('flat page response compatibility', () => {
  it('accepts older unpaged responses and validates new continuation cursors', () => {
    const society = { id: randomUUID(), name: 'Fixture', isDemo: true };
    expect(flatSelectionSchema.parse({ flats: [] })).toEqual({ flats: [] });
    expect(lookupSchema.parse({ society, flats: [] })).toEqual({
      society,
      flats: [],
    });
    for (const nextCursor of [randomUUID(), null]) {
      expect(
        flatSelectionSchema.parse({ flats: [], nextCursor }).nextCursor,
      ).toBe(nextCursor);
      expect(
        lookupSchema.parse({ society, flats: [], nextCursor }).nextCursor,
      ).toBe(nextCursor);
    }
    expect(
      flatSelectionSchema.safeParse({ flats: [], nextCursor: 'invalid' })
        .success,
    ).toBe(false);
  });
});
