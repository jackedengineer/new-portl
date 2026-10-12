import { describe, expect, it } from 'vitest';
import {
  noticeCreateInput,
  noticeEditInput,
  noticeListQuery,
  notificationSchema,
} from '@portl/contracts';

describe('notice contracts', () => {
  it('requires bounded plain text and rejects forged author, state or audience', () => {
    const input = {
      id: 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
      title: ' Water supply ',
      body: ' Supply resumes at 6 pm. ',
    };
    expect(noticeCreateInput.parse(input)).toEqual({
      ...input,
      title: 'Water supply',
      body: 'Supply resumes at 6 pm.',
    });
    for (const extra of [
      { status: 'PUBLISHED' },
      { createdBy: 'someone' },
      { towerId: 'A' },
    ])
      expect(noticeCreateInput.safeParse({ ...input, ...extra }).success).toBe(
        false,
      );
    for (const patch of [
      { title: ' ' },
      { title: 'a'.repeat(161) },
      { body: 'a'.repeat(10001) },
      { id: 'invalid' },
    ])
      expect(noticeCreateInput.safeParse({ ...input, ...patch }).success).toBe(
        false,
      );
  });
  it('requires a positive expected version and bounded list queries', () => {
    expect(
      noticeEditInput.safeParse({
        title: 'Title',
        body: 'Body',
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(noticeListQuery.safeParse({ view: 'GUARD' }).success).toBe(false);
    expect(
      noticeListQuery.safeParse({ view: 'RESIDENT', cursor: 'x'.repeat(301) })
        .success,
    ).toBe(false);
  });
  it('recognizes a society notice inbox item without exposing content', () => {
    expect(
      notificationSchema.parse({
        id: 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
        societyId: 'society',
        type: 'NOTICE_PUBLISHED',
        resourceKind: 'NOTICE',
        resourceId: 'notice',
        view: 'RESIDENT',
        createdAt: new Date().toISOString(),
        readAt: null,
      }).resourceKind,
    ).toBe('NOTICE');
  });
});
