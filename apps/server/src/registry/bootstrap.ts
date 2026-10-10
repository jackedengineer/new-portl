import { randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { z } from 'zod';
import { emailSchema, societyLookupInput } from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { hash } from './context.js';

export const bootstrapInput = z
  .strictObject({
    adminEmail: emailSchema,
    adminName: z.string().trim().min(2).max(80),
    societies: z
      .array(
        z.strictObject({
          name: z.string().trim().min(2).max(100),
          code: societyLookupInput.shape.code,
          towers: z
            .array(
              z.strictObject({
                name: z.string().trim().min(1).max(40),
                flats: z
                  .array(z.string().trim().min(1).max(20))
                  .min(1)
                  .max(500),
              }),
            )
            .min(1)
            .max(30),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((input, ctx) => {
    if (
      new Set(input.societies.map((s) => s.code)).size !==
      input.societies.length
    )
      ctx.addIssue({ code: 'custom', message: 'Society codes must be unique' });
    for (const society of input.societies) {
      if (
        society.towers.reduce((n, t) => n + t.flats.length, 0) > 500 ||
        new Set(society.towers.map((t) => t.name)).size !==
          society.towers.length ||
        society.towers.some((t) => new Set(t.flats).size !== t.flats.length)
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Use unique towers/flats and at most 500 flats per demo society',
        });
    }
  });
export async function bootstrapSocieties(
  db: PrismaClient,
  secret: string,
  config: z.infer<typeof bootstrapInput>,
  totpSecret: string,
  confirmation: string,
) {
  if (
    !/^\d{6}$/.test(confirmation) ||
    !(await createOTP(totpSecret).verify(confirmation))
  )
    throw new Error('Authenticator confirmation failed');
  const encrypted = await symmetricEncrypt({ key: secret, data: totpSecret });
  return db.$transaction(
    async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: config.adminEmail },
      });
      if (
        existing &&
        (await tx.twoFactor.findUnique({ where: { userId: existing.id } }))
      )
        throw new Error(
          'Authenticator already configured; refusing replacement',
        );
      const user = await tx.user.upsert({
        where: { email: config.adminEmail },
        create: {
          id: randomUUID(),
          email: config.adminEmail,
          name: config.adminName,
          emailVerified: false,
          twoFactorEnabled: true,
        },
        update: { twoFactorEnabled: true },
      });
      await tx.twoFactor.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          secret: encrypted,
          backupCodes: '[]',
          verified: true,
        },
      });
      const societyIds = [];
      for (const item of config.societies) {
        const society = await tx.society.create({
          data: {
            name: item.name,
            joinCodeHash: hash(item.code),
            isDemo: true,
          },
        });
        societyIds.push(society.id);
        for (const group of item.towers) {
          const tower = await tx.tower.create({
            data: { societyId: society.id, name: group.name },
          });
          await tx.flat.createMany({
            data: group.flats.map((label) => ({
              societyId: society.id,
              towerId: tower.id,
              label,
            })),
          });
        }
        await tx.membership.create({
          data: { societyId: society.id, userId: user.id, role: 'ADMIN' },
        });
        await tx.registryAudit.create({
          data: {
            societyId: society.id,
            actorId: user.id,
            action: 'OPERATOR_BOOTSTRAP',
            resourceId: user.id,
            requestId: randomUUID(),
          },
        });
      }
      return { societyCount: societyIds.length };
    },
    { timeout: 30_000 },
  );
}
