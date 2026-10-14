import { z } from 'zod';
import { emailSchema, idSchema } from './common.ts';

export const POLICY_VERSION = '2026-10-14';
export const policyAcceptanceInput = z.strictObject({
  adult: z.literal(true),
  termsVersion: z.literal(POLICY_VERSION),
  privacyVersion: z.literal(POLICY_VERSION),
});
export const deletionStartInput = z.strictObject({ email: emailSchema });
export const deletionProofInput = z.strictObject({
  challengeId: z.uuid(),
  receiptToken: z.string().regex(/^[a-f0-9]{64}$/),
  otp: z.string().regex(/^\d{6}$/),
  confirmation: z.literal('DELETE'),
  expectedUserId: idSchema.optional(),
});
export const deletionStatusInput = z.strictObject({
  receiptToken: deletionProofInput.shape.receiptToken,
});
export const deletionChallengeSchema = z.strictObject({
  challengeId: z.uuid(),
  receiptToken: deletionProofInput.shape.receiptToken,
  expiresIn: z.literal(300),
});
export const deletionStatusSchema = z.strictObject({
  status: z.enum(['PENDING', 'COMPLETED']),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const accountSessionsSchema = z.object({
  items: z.array(
    z.object({
      id: idSchema,
      current: z.boolean(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
});
export const revokeSessionInput = z.strictObject({ sessionId: idSchema });
