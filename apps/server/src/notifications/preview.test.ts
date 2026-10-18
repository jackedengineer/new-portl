import { expect, it } from 'vitest';
import { notificationPreview, notificationType } from '@portl/contracts';

it.each([
  ['VISITOR_REQUESTED', 'Aarav is waiting at Main gate.'],
  ['VISITOR_APPROVED', 'Aarav was approved for entry at Main gate.'],
  ['VISITOR_REJECTED', 'Aarav’s entry request at Main gate was declined.'],
  ['VISITOR_ENTERED', 'Aarav entered through Main gate.'],
  ['VISITOR_EXITED', 'Aarav exited through Main gate.'],
  ['GUEST_ENTERED', 'Aarav entered through Main gate.'],
  ['GUEST_EXITED', 'Aarav exited through Main gate.'],
] as const)('describes %s with the visitor and recorded gate', (type, body) => {
  expect(
    notificationPreview(type, { visitorName: 'Aarav', gateName: 'Main gate' })
      .body,
  ).toBe(body);
});
it('shows a published notice title and excerpt, normalizing control characters', () => {
  expect(
    notificationPreview('NOTICE_PUBLISHED', {
      noticeTitle: 'Water\n supply update',
      noticeBody: 'Supply\u202e resumes\t at 6 PM.',
    }),
  ).toEqual({ title: 'Water supply update', body: 'Supply resumes at 6 PM.' });
});
it.each(notificationType.options)(
  'has meaningful generic fallback for %s without personal context',
  (type) => {
    const preview = notificationPreview(type);
    expect(preview.title).not.toBe('Portl community update');
    expect(preview.body).toBeTruthy();
    expect(preview.body).not.toContain('undefined');
  },
);
it('bounds Unicode content to a safe push payload and preserves whole codepoints', () => {
  const preview = notificationPreview('NOTICE_PUBLISHED', {
    noticeTitle: '🏠'.repeat(1000),
    noticeBody: '🏠'.repeat(10000),
  });
  expect([...preview.title].length).toBeLessThanOrEqual(80);
  expect([...preview.body].length).toBeLessThanOrEqual(220);
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(1500);
  expect(preview.title).not.toMatch(/[\ud800-\udbff]$/u);
});
