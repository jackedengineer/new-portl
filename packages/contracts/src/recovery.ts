import { z } from 'zod';
export const recoveryOperation = z.enum([
  'RESET_AUTHENTICATOR',
  'RESTORE_ADMIN',
]);
export const adminRecoverySchema = z.strictObject({
  request: z
    .strictObject({
      id: z.uuid(),
      operation: recoveryOperation,
      societyName: z.string().nullable(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export const recoveryEnrollInput = z.strictObject({ id: z.uuid() });
export const recoveryEnrollmentSchema = z.strictObject({
  id: z.uuid(),
  totpURI: z.string().startsWith('otpauth://totp/'),
  setupKey: z.string().min(16),
});
export const recoveryConfirmInput = z.strictObject({
  id: z.uuid(),
  otp: z.string().regex(/^\d{6}$/),
  totpCode: z.string().regex(/^\d{6}$/),
  confirmation: z.literal('RECOVER'),
});
