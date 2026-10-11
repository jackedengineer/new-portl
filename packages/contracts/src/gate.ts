import { z } from 'zod';
import { emailSchema, flatSchema, idSchema } from './common.ts';

export const gateView = z.enum(['RESIDENT', 'GUARD', 'ADMIN']);
export const visitorCategory = z.enum(['GUEST', 'DELIVERY', 'CAB', 'SERVICE']);
const command = {
  intentId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
};
export const arrivalInput = z.strictObject({
  intentId: command.intentId,
  gateId: idSchema,
  flatId: idSchema,
  visitorName: z.string().trim().min(2).max(80),
  category: visitorCategory,
  company: z.string().trim().max(80).optional(),
});
export const gateDecisionInput = z.strictObject({
  ...command,
  decision: z.enum(['APPROVE', 'REJECT']),
});
export const gateCancelInput = z.strictObject(command);
export const movementInput = z.strictObject({ ...command, gateId: idSchema });
export const gateListQuery = z.strictObject({
  view: gateView,
  filter: z.enum(['WAITING', 'READY', 'INSIDE', 'HISTORY']).default('WAITING'),
  cursor: idSchema.optional(),
});
export const gateSetupQuery = z.strictObject({
  view: gateView,
  search: z.string().trim().max(80).default(''),
});
export const gateInput = z.strictObject({
  name: z.string().trim().min(2).max(60),
});
export const guardAssignmentInput = z.strictObject({
  email: emailSchema,
  gateId: idSchema,
});
export const gateSchema = z.object({ id: idSchema, name: z.string() });
export const guardAssignmentSchema = z.object({
  id: idSchema,
  gate: gateSchema,
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
});
export const gateSetupSchema = z.object({
  gates: z.array(gateSchema),
  flats: z.array(flatSchema),
  assignments: z.array(guardAssignmentSchema),
  serverNow: z.iso.datetime(),
});
export const movementSchema = z.object({
  id: idSchema,
  type: z.enum(['ENTRY', 'EXIT']),
  gate: gateSchema,
  at: z.iso.datetime(),
});
export const visitorRequestSchema = z.object({
  id: idSchema,
  version: z.number().int().positive(),
  visitorName: z.string(),
  category: visitorCategory,
  company: z.string().nullable(),
  flat: flatSchema,
  gate: gateSchema,
  status: z.enum([
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'EXPIRED',
    'INVALIDATED',
  ]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  approvedUntil: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  presence: z.enum(['NOT_ENTERED', 'INSIDE', 'EXITED']),
  events: z.array(movementSchema),
});
export const visitorDetailSchema = z.object({
  request: visitorRequestSchema,
  serverNow: z.iso.datetime(),
});
export const visitorListSchema = z.object({
  items: z.array(visitorRequestSchema),
  nextCursor: z.string().nullable(),
  serverNow: z.iso.datetime(),
});
export const gateCommandSchema = z.object({
  requestId: idSchema,
  version: z.number().int().positive(),
});
export type GateView = z.infer<typeof gateView>;
export type GateFilter = z.infer<typeof gateListQuery>['filter'];
export type ArrivalInput = z.infer<typeof arrivalInput>;
export type GateDecisionInput = z.infer<typeof gateDecisionInput>;
export type MovementInput = z.infer<typeof movementInput>;
export type GateCancelInput = z.infer<typeof gateCancelInput>;
export type GateSetup = z.infer<typeof gateSetupSchema>;
export type VisitorRequest = z.infer<typeof visitorRequestSchema>;
export type GateCommand = z.infer<typeof gateCommandSchema>;
