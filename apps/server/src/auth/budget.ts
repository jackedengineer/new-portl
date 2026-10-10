import { createHmac } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

export async function consumeBudget(
  db: PrismaClient,
  secret: string,
  subject: string,
  bucket: string,
  max: number,
  seconds: number,
) {
  const key = createHmac('sha256', secret)
    .update(`${bucket}:${subject}`)
    .digest('hex');
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO portl_auth."OtpThrottle" (key, count, "resetAt") VALUES (${key}, 1, now() + ${seconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET count = CASE WHEN portl_auth."OtpThrottle"."resetAt" <= now() THEN 1 ELSE portl_auth."OtpThrottle".count + 1 END,
      "resetAt" = CASE WHEN portl_auth."OtpThrottle"."resetAt" <= now() THEN now() + ${seconds} * interval '1 second' ELSE portl_auth."OtpThrottle"."resetAt" END
    WHERE portl_auth."OtpThrottle"."resetAt" <= now() OR portl_auth."OtpThrottle".count < ${max}
    RETURNING count`;
  return rows.length === 1;
}
