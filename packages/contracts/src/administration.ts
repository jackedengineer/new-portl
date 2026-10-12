import { z } from 'zod';
import { idSchema, relationshipSchema } from './common.ts';

const label = z.string().trim().min(1).max(80);
const version = z.number().int().positive().max(2147483647);
export const administrationQuery = z.strictObject({
  cursor: idSchema.optional(),
  search: z.string().trim().max(80).default(''),
  archived: z.enum(['false', 'true']).default('false'),
});
export const towerCreateInput = z.strictObject({ id: z.uuid(), name: label });
export const towerEditInput = z.strictObject({
  name: label,
  expectedVersion: version,
});
export const flatCreateInput = z.strictObject({
  id: z.uuid(),
  towerId: idSchema,
  label,
});
export const flatEditInput = z.strictObject({
  label,
  expectedVersion: version,
});
export const archiveInput = z.strictObject({ expectedVersion: version });
export const endOccupancyInput = z.strictObject({
  expectedStartedAt: z.iso.datetime(),
});
export const towerAdminSchema = z.object({
  id: idSchema,
  name: z.string(),
  archived: z.boolean(),
  version,
});
export const flatAdminSchema = z.object({
  id: idSchema,
  towerId: idSchema,
  tower: z.string(),
  label: z.string(),
  archived: z.boolean(),
  version,
});
export const residentAdminSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string(),
  email: z.string(),
  flatId: idSchema,
  flat: z.string(),
  tower: z.string(),
  relationship: relationshipSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export const directoryKind = z.enum(['STAFF', 'SERVICE_PROVIDER']);
export const directoryFields = {
  name: label,
  kind: directoryKind,
  service: label,
  description: z.string().trim().max(500),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .nullable(),
  sharePhone: z.boolean(),
};
const sharingValid = (v: { phone: string | null; sharePhone: boolean }) =>
  !v.sharePhone || !!v.phone;
export const directoryCreateInput = z
  .strictObject({ id: z.uuid(), ...directoryFields })
  .refine(sharingValid, 'A shared contact needs a phone number');
export const directoryEditInput = z
  .strictObject({ ...directoryFields, expectedVersion: version })
  .refine(sharingValid, 'A shared contact needs a phone number');
export const directoryQuery = administrationQuery.extend({
  view: z.enum(['ADMIN', 'RESIDENT']).default('RESIDENT'),
  kind: directoryKind.optional(),
});
export const directoryEntrySchema = z.object({
  id: idSchema,
  ...directoryFields,
  archived: z.boolean(),
  version,
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: idSchema.nullable() });
export const towerAdminListSchema = page(towerAdminSchema);
export const flatAdminListSchema = page(flatAdminSchema);
export const residentAdminListSchema = page(residentAdminSchema);
export const directoryListSchema = page(directoryEntrySchema);
export const administrationSummarySchema = z.object({
  towers: z.number().int().nonnegative(),
  flats: z.number().int().nonnegative(),
  residents: z.number().int().nonnegative(),
  pendingApplications: z.number().int().nonnegative(),
  gates: z.number().int().nonnegative(),
  guards: z.number().int().nonnegative(),
  staff: z.number().int().nonnegative(),
  serviceProviders: z.number().int().nonnegative(),
});
export type AdministrationQuery = z.infer<typeof administrationQuery>;
export type DirectoryQuery = z.infer<typeof directoryQuery>;
export type DirectoryCreate = z.infer<typeof directoryCreateInput>;
export type DirectoryEdit = z.infer<typeof directoryEditInput>;
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;
export type TowerAdmin = z.infer<typeof towerAdminSchema>;
export type FlatAdmin = z.infer<typeof flatAdminSchema>;
export type ResidentAdmin = z.infer<typeof residentAdminSchema>;
