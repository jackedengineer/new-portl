import { z } from 'zod';
import { idSchema } from './common.ts';

export const noticeStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const noticeView = z.enum(['RESIDENT', 'ADMIN']);
const content = {
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
};
export const noticeCreateInput = z.strictObject({ id: z.uuid(), ...content });
export const noticeCommandInput = z.strictObject({
  expectedVersion: z.number().int().min(1).max(2147483646),
});
export const noticeEditInput = noticeCommandInput.extend(content);
export const noticeListQuery = z.strictObject({
  view: noticeView.default('RESIDENT'),
  status: noticeStatus.optional(),
  cursor: z.string().max(300).optional(),
});
export const noticeSchema = z.object({
  id: z.uuid(),
  societyId: idSchema,
  title: z.string(),
  body: z.string(),
  status: noticeStatus,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});
export const noticeListSchema = z.object({
  items: z.array(noticeSchema.omit({ body: true })),
  nextCursor: z.string().nullable(),
});
export type Notice = z.infer<typeof noticeSchema>;
export type NoticeView = z.infer<typeof noticeView>;
