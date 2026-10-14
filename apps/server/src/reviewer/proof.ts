import { createHmac, timingSafeEqual } from 'node:crypto';

export const reviewerKeyHash = (secret: string, userId: string, key: string) =>
  createHmac('sha256', secret)
    .update(JSON.stringify(['reviewer', userId, key]))
    .digest('hex');
export function verifyReviewerKey(
  secret: string,
  userId: string,
  key: string,
  digest: string,
) {
  const expected = Buffer.from(reviewerKeyHash(secret, userId, key), 'hex');
  const actual = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
