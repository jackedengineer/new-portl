import { z } from 'zod';
export const relationshipSchema = z.enum(['OWNER', 'TENANT']);

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
export const flatSchema = z.object({
  id: idSchema,
  label: z.string(),
  tower: z.string(),
});
