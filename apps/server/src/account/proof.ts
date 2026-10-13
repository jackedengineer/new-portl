import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
type Challenge = { id: string; userId: string; email: string };
export function accountProof(secret: string) {
  const digest = (challenge: Challenge, otp: string) =>
    createHmac('sha256', secret)
      .update(
        JSON.stringify([
          'delete-account',
          challenge.id,
          challenge.userId,
          challenge.email,
          otp,
        ]),
      )
      .digest('hex');
  return {
    digest,
    verify(challenge: Challenge, otp: string, stored: string) {
      if (!/^\d{6}$/.test(otp) || !/^[a-f0-9]{64}$/.test(stored)) return false;
      return timingSafeEqual(
        Buffer.from(digest(challenge, otp), 'hex'),
        Buffer.from(stored, 'hex'),
      );
    },
    email: (email: string) =>
      createHash('sha256').update(`deleted-email:${email}`).digest('hex'),
    receipt: (token: string) =>
      createHash('sha256').update(token).digest('hex'),
    subject: (userId: string) =>
      createHash('sha256').update(`portl-erased-user:${userId}`).digest('hex'),
  };
}
export type AccountProof = ReturnType<typeof accountProof>;
