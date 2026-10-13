import { createOTP } from '@better-auth/utils/otp';
import { symmetricDecrypt } from 'better-auth/crypto';
import { z } from 'zod';
import {
  recoveryConfirmInput,
  adminRecoverySchema,
  recoveryOperation,
  recoveryEnrollmentSchema,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError } from '../registry/context.js';
import { recoveryEmailProof, recoveryTotpReplay } from './proof.js';
const stored = z.object({
  request: z
    .object({
      id: z.uuid(),
      operation: recoveryOperation,
      email: z.email(),
      societyName: z.string().nullable(),
      encryptedSecret: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  completedAt: z.string().nullable(),
});
const invalid = () =>
  new DomainError(
    400,
    'INVALID_RECOVERY_PROOF',
    'Recovery proof is invalid or expired. Contact the operator to restart.',
  );
export function adminRecoveryService(db: PrismaClient, secret: string) {
  async function view(userId: string, sessionId: string) {
    const [row] = await db.$queryRaw<
      { value: unknown }[]
    >`SELECT portl_auth.admin_recovery_view(${userId},${sessionId}) AS value`;
    return stored.parse(row?.value);
  }
  return {
    async status(userId: string, sessionId: string) {
      const result = await view(userId, sessionId);
      return adminRecoverySchema.parse({
        request: result.request
          ? {
              id: result.request.id,
              operation: result.request.operation,
              societyName: result.request.societyName,
              expiresAt: new Date(result.request.expiresAt).toISOString(),
            }
          : null,
        completedAt: result.completedAt
          ? new Date(result.completedAt).toISOString()
          : null,
      });
    },
    async enroll(userId: string, sessionId: string, id: string) {
      const { request } = await view(userId, sessionId);
      if (!request || request.id !== id) throw invalid();
      const value = await symmetricDecrypt({
        key: secret,
        data: request.encryptedSecret,
      });
      const totpURI = createOTP(value).url('Portl', request.email);
      return recoveryEnrollmentSchema.parse({
        id,
        totpURI,
        setupKey: new URL(totpURI).searchParams.get('secret'),
      });
    },
    async confirm(userId: string, sessionId: string, raw: unknown) {
      const input = recoveryConfirmInput.parse(raw);
      const { request } = await view(userId, sessionId);
      if (!request || request.id !== input.id) throw invalid();
      const value = await symmetricDecrypt({
        key: secret,
        data: request.encryptedSecret,
      });
      const verified = await createOTP(value).verify(input.totpCode);
      const emailProof = recoveryEmailProof(
          secret,
          input.id,
          userId,
          request.email,
          input.otp,
        ),
        usedCode = recoveryTotpReplay(secret, userId, input.totpCode);
      const [row] = await db.$queryRaw<
        { result: string }[]
      >`SELECT portl_auth.complete_admin_recovery(${input.id},${userId},${sessionId},${emailProof},${verified},${usedCode}) AS result`;
      if (row?.result === 'COMPLETED') return { success: true };
      if (row?.result === 'CHANGED')
        throw new DomainError(
          409,
          'RECOVERY_CHANGED',
          'Account or society state changed. Ask the operator to prepare a new request.',
        );
      throw invalid();
    },
  };
}
