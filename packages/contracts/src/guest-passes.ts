import { z } from 'zod';
import { flatSchema, idSchema } from './common.ts';
import { gateView, movementSchema } from './gate.ts';

export const guestPassCode = z
  .string()
  .max(32)
  .transform((s) => s.trim().toUpperCase().replace(/[- ]/g, ''))
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{16}$/));
export const guestPassCreateInput = z
  .strictObject({
    intentId: z.uuid(),
    flatId: idSchema,
    visitorName: z.string().trim().min(2).max(80),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  })
  .refine((v) => {
    const duration = Date.parse(v.validUntil) - Date.parse(v.validFrom);
    return duration >= 900000 && duration <= 86400000;
  }, 'Choose a window between 15 minutes and 24 hours');
const command = {
  intentId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
};
export const guestPassRevokeInput = z.strictObject(command);
export const guestPassExitInput = z.strictObject({
  ...command,
  gateId: idSchema,
});
export const guestPassEntryInput = z.strictObject({
  ...command,
  gateId: idSchema,
  code: guestPassCode,
});
export const guestPassVerifyInput = z.strictObject({
  gateId: idSchema,
  code: guestPassCode,
});
export const guestPassListQuery = z.strictObject({
  view: gateView,
  filter: z.enum(['UPCOMING', 'INSIDE', 'HISTORY']).default('UPCOMING'),
  cursor: idSchema.optional(),
});
export const guestPassSchema = z.object({
  id: idSchema,
  version: z.number().int().positive(),
  visitorName: z.string(),
  flat: flatSchema,
  createdAt: z.iso.datetime(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  status: z.enum([
    'SCHEDULED',
    'READY',
    'EXPIRED',
    'REVOKED',
    'INVALIDATED',
    'INSIDE',
    'COMPLETED',
  ]),
  presence: z.enum(['NOT_ENTERED', 'INSIDE', 'EXITED']),
  events: z.array(movementSchema),
});
export const guestPassDetailSchema = z.object({
  pass: guestPassSchema,
  serverNow: z.iso.datetime(),
});
export const guestPassListSchema = z.object({
  items: z.array(guestPassSchema),
  nextCursor: z.string().nullable(),
  serverNow: z.iso.datetime(),
});
export const guestPassSetupSchema = z.object({
  flats: z.array(flatSchema),
  serverNow: z.iso.datetime(),
});
export const guestPassCommandSchema = z.object({
  passId: idSchema,
  version: z.number().int().positive(),
});
export const guestPassRevealSchema = z.object({ code: guestPassCode });
export type GuestPass = z.infer<typeof guestPassSchema>;
export type GuestPassCreate = z.infer<typeof guestPassCreateInput>;
export type GuestPassRevoke = z.infer<typeof guestPassRevokeInput>;
export type GuestPassEntry = z.infer<typeof guestPassEntryInput>;
export type GuestPassExit = z.infer<typeof guestPassExitInput>;
export type GuestPassFilter = z.infer<typeof guestPassListQuery>['filter'];
