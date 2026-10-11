import { z } from 'zod';
import { idSchema } from './common.ts';
export const notificationType = z.enum([
  'VISITOR_REQUESTED',
  'VISITOR_APPROVED',
  'VISITOR_REJECTED',
  'VISITOR_ENTERED',
  'VISITOR_EXITED',
  'GUEST_ENTERED',
  'GUEST_EXITED',
]);
export const notificationTapInput = z.strictObject({
  notificationId: z.uuid(),
});
export const deviceRegistrationInput = z.strictObject({
  installationId: z.uuid(),
  token: z
    .string()
    .max(200)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(['android', 'ios']),
});
export const deviceRemovalInput = z.strictObject({ installationId: z.uuid() });
export const notificationListQuery = z.strictObject({
  cursor: z.string().max(300).optional(),
});
export const notificationSchema = z.object({
  id: z.uuid(),
  societyId: idSchema,
  type: notificationType,
  resourceKind: z.enum(['REQUEST', 'PASS']),
  resourceId: idSchema,
  view: z.enum(['RESIDENT', 'GUARD']),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unread: z.number().int().nonnegative(),
});
export type PortlNotification = z.infer<typeof notificationSchema>;
export type DeviceRegistration = z.infer<typeof deviceRegistrationInput>;
export const notificationCopy: Record<
  z.infer<typeof notificationType>,
  { title: string; body: string }
> = {
  VISITOR_REQUESTED: {
    title: 'Visitor approval needed',
    body: 'Open Portl to review a request from the gate.',
  },
  VISITOR_APPROVED: {
    title: 'Visitor approved',
    body: 'Open Portl to check the current gate request.',
  },
  VISITOR_REJECTED: {
    title: 'Visitor declined',
    body: 'Open Portl to check the current gate request.',
  },
  VISITOR_ENTERED: {
    title: 'Visitor entry recorded',
    body: 'Open Portl to view the gate update.',
  },
  VISITOR_EXITED: {
    title: 'Visitor exit recorded',
    body: 'Open Portl to view the gate update.',
  },
  GUEST_ENTERED: {
    title: 'Guest entry recorded',
    body: 'Open Portl to view the guest pass update.',
  },
  GUEST_EXITED: {
    title: 'Guest exit recorded',
    body: 'Open Portl to view the guest pass update.',
  },
};
