import { z } from 'zod';
import { idSchema } from './common.ts';
import { policyAcceptanceInput } from './account.ts';

export const reviewerRole = z.enum(['RESIDENT', 'GUARD', 'ADMIN']);
export const reviewerKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const reviewerSignInInput = z.strictObject({
  role: reviewerRole,
  accessKey: reviewerKey,
  policyAcceptance: policyAcceptanceInput,
  reviewAcknowledged: z.literal(true),
});
export const reviewerReauthInput = z.strictObject({ accessKey: reviewerKey });
export const reviewerIdentitySchema = z.object({
  societyId: idSchema,
  role: reviewerRole,
});

export const reviewLifecycleInput = z.strictObject({
  purpose: z.enum(['email-change', 'deletion']),
});
export const reviewLifecycleSchema = z.object({
  purpose: z.enum(['email-change', 'deletion']),
  nextEmail: z.email(),
  expiresAt: z.iso.datetime(),
});
export const reviewCodeInput = z.strictObject({
  purpose: z.enum(['verify-current-email', 'change-email', 'delete-account']),
});
export const reviewCodeSchema = z.object({ otp: z.string().regex(/^\d{6}$/) });
