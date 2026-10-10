import { z } from 'zod';

export const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/);
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
export const relationshipSchema = z.enum(['OWNER', 'TENANT']);
export const tokenInput = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const societyLookupInput = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{12}$/),
});
export const applicationInput = z.strictObject({
  societyCode: societyLookupInput.shape.code,
  name: z.string().trim().min(2).max(80),
  flatId: idSchema,
  relationship: relationshipSchema,
});
export const invitationInput = z.strictObject({
  email: emailSchema,
  flatId: idSchema,
  relationship: relationshipSchema,
});
export const rejectionReason = z.enum([
  'DETAILS_COULD_NOT_BE_VERIFIED',
  'INCORRECT_FLAT',
  'CONTACT_SOCIETY_OFFICE',
]);
export const decisionInput = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE') }),
  z.strictObject({ decision: z.literal('REJECT'), reason: rejectionReason }),
]);
export const flatSchema = z.object({
  id: idSchema,
  label: z.string(),
  tower: z.string(),
});
export const societySchema = z.object({
  id: idSchema,
  name: z.string(),
  isDemo: z.boolean(),
});
export const membershipSchema = z.object({
  society: societySchema,
  roles: z.array(z.enum(['RESIDENT', 'GUARD', 'ADMIN'])),
  flats: z.array(flatSchema.extend({ relationship: relationshipSchema })),
});
export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
  }),
  memberships: z.array(membershipSchema),
  onboardingRequired: z.boolean(),
  adminAssuredUntil: z.string().nullable(),
  adminAuthenticatorConfigured: z.boolean(),
});
export const applicationSchema = z.object({
  id: idSchema,
  society: societySchema,
  flat: flatSchema,
  name: z.string(),
  relationship: relationshipSchema,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']),
  reason: rejectionReason.nullable(),
  createdAt: z.string(),
});
export const invitationSchema = z.object({
  id: idSchema,
  email: z.string(),
  flat: flatSchema,
  relationship: relationshipSchema,
  status: z.enum(['ACTIVE', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string(),
});
export const lookupSchema = z.object({
  society: societySchema,
  flats: z.array(flatSchema),
});
export const previewSchema = z.object({
  society: societySchema,
  flat: flatSchema,
  relationship: relationshipSchema,
  expiresAt: z.string(),
});
export const applicationListSchema = z.object({
  items: z.array(applicationSchema),
  nextCursor: z.string().nullable(),
});
export const invitationListSchema = z.object({
  items: z.array(invitationSchema),
  nextCursor: z.string().nullable(),
});
export const invitationCreatedSchema = z.object({
  invitation: invitationSchema,
  token: z.string(),
});
export type Me = z.infer<typeof meSchema>;
export type Society = z.infer<typeof societySchema>;
export type Flat = z.infer<typeof flatSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type ResidentApplication = z.infer<typeof applicationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type ApplicationInput = z.infer<typeof applicationInput>;
export type InvitationInput = z.infer<typeof invitationInput>;
export type DecisionInput = z.infer<typeof decisionInput>;
