import { z } from 'zod';

const runtimeEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUSTED_INGRESS: z.enum(['none', 'render']).default('none'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export function parseRuntimeEnv(input: Record<string, string | undefined>) {
  const result = runtimeEnvSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid runtime environment: ${fields.join(', ')}`);
  }
  return result.data;
}
