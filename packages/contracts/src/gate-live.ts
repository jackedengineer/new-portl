import { z } from 'zod';
import { idSchema } from './common.ts';
import { gateView } from './gate.ts';

export const gateSubscriptionSchema = z.strictObject({
  userId: idSchema,
  societyId: idSchema,
  view: gateView,
});
export const gateSignalSchema = z.strictObject({
  societyId: idSchema,
  requestId: idSchema,
  version: z.number().int().positive().max(2147483647),
});
export type GateSubscription = z.infer<typeof gateSubscriptionSchema>;
export type GateSignal = z.infer<typeof gateSignalSchema>;
