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
  'NOTICE_PUBLISHED',
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
export const notificationPreviewSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(440),
});
export type NotificationPreview = z.infer<typeof notificationPreviewSchema>;
export const notificationSchema = z.object({
  id: z.uuid(),
  societyId: idSchema,
  type: notificationType,
  resourceKind: z.enum(['REQUEST', 'PASS', 'NOTICE']),
  resourceId: idSchema,
  view: z.enum(['RESIDENT', 'GUARD']),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  preview: notificationPreviewSchema.optional(),
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
  NOTICE_PUBLISHED: {
    title: 'New society notice',
    body: 'Open Portl to read an update from your society office.',
  },
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

export type NotificationContext = {
  visitorName?: string | null;
  gateName?: string | null;
  noticeTitle?: string | null;
  noticeBody?: string | null;
};
function previewText(value: string | null | undefined, limit: number) {
  const normalized = (value ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const points = [...normalized];
  return points.length > limit
    ? points
        .slice(0, limit - 1)
        .join('')
        .trimEnd() + '…'
    : normalized;
}
/** Context is supplied only after current recipient authorization and policy checks. */
export function notificationPreview(
  type: z.infer<typeof notificationType>,
  context: NotificationContext = {},
): NotificationPreview {
  const fallback = notificationCopy[type];
  if (type === 'NOTICE_PUBLISHED')
    return {
      title: previewText(context.noticeTitle, 80) || fallback.title,
      body: previewText(context.noticeBody, 220) || fallback.body,
    };
  const name = previewText(context.visitorName, 80);
  const gate = previewText(context.gateName, 80);
  if (!name || !gate) return fallback;
  const bodies = {
    VISITOR_REQUESTED: `${name} is waiting at ${gate}.`,
    VISITOR_APPROVED: `${name} was approved for entry at ${gate}.`,
    VISITOR_REJECTED: `${name}’s entry request at ${gate} was declined.`,
    VISITOR_ENTERED: `${name} entered through ${gate}.`,
    VISITOR_EXITED: `${name} exited through ${gate}.`,
    GUEST_ENTERED: `${name} entered through ${gate}.`,
    GUEST_EXITED: `${name} exited through ${gate}.`,
  };
  return { title: fallback.title, body: previewText(bodies[type], 220) };
}
