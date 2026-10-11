import { z } from 'zod';

function isExpoGoOrigin(value: string) {
  if (!/^exp:\/\/[^\s/\\?#]+$/.test(value) || !URL.canParse(value))
    return false;
  const url = new URL(value);
  return (
    !!url.hostname &&
    !url.username &&
    !url.password &&
    !url.pathname &&
    !url.search &&
    !url.hash
  );
}

const authEnvSchema = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(?:ql)?:\/\//.test(value)),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  }),
  TRUSTED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((item) => item.trim()))
    .refine((values) =>
      values.every(
        (value) =>
          value.length > 0 &&
          !value.includes('*') &&
          (/^(https?:\/\/[^\s/]+|portl:\/\/)$/.test(value) ||
            isExpoGoOrigin(value)),
      ),
    ),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z
    .string()
    .refine(
      (value) =>
        z.email().safeParse(value.match(/<([^>]+)>$/)?.[1] ?? value).success,
    ),
});

export function parseAuthEnv(
  input: Record<string, string | undefined>,
  mode: string,
) {
  const result = authEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid authentication environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  if (
    mode !== 'development' &&
    result.data.TRUSTED_ORIGINS.some((origin) => origin.startsWith('exp://'))
  ) {
    throw new Error('Invalid authentication environment: TRUSTED_ORIGINS');
  }
  if (
    mode === 'production' &&
    !result.data.BETTER_AUTH_URL.startsWith('https://')
  ) {
    throw new Error('Invalid authentication environment: BETTER_AUTH_URL');
  }
  if (
    mode === 'production' &&
    result.data.TRUSTED_ORIGINS.some((origin) => origin.startsWith('http://'))
  ) {
    throw new Error('Invalid authentication environment: TRUSTED_ORIGINS');
  }
  return result.data;
}

export type AuthEnv = ReturnType<typeof parseAuthEnv>;
