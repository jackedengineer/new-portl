import { createHmac } from 'node:crypto';
export const recoveryEmailProof = (
  secret: string,
  id: string,
  userId: string,
  email: string,
  otp: string,
) =>
  createHmac('sha256', secret)
    .update(JSON.stringify(['admin-recovery-v1', id, userId, email, otp]))
    .digest('hex');
export const recoveryTotpReplay = (
  secret: string,
  userId: string,
  code: string,
) =>
  createHmac('sha256', secret)
    .update(`otp:totp:${userId}:${code}`)
    .digest('base64url');
