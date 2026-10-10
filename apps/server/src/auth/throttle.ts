import { createHmac } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client.js';

export function emailThrottleKey(
  secret: string,
  email: string,
  bucket: string,
) {
  return createHmac('sha256', secret)
    .update(`email-otp:${bucket}:${email}`)
    .digest('hex');
}

async function consume(
  db: PrismaClient,
  key: string,
  windowSeconds: number,
  max: number,
) {
  // One PostgreSQL statement arbitrates concurrent requests across API replicas.
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO portl_auth."OtpThrottle" ("key", "count", "resetAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "OtpThrottle"."resetAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "OtpThrottle"."count" + 1 END,
      "resetAt" = CASE WHEN "OtpThrottle"."resetAt" <= CURRENT_TIMESTAMP
        THEN CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second') ELSE "OtpThrottle"."resetAt" END
    WHERE "OtpThrottle"."resetAt" <= CURRENT_TIMESTAMP OR "OtpThrottle"."count" < ${max}
    RETURNING "key"
  `;
  return rows.length === 1;
}

export async function allowEmailSend(
  db: PrismaClient,
  secret: string,
  email: string,
) {
  if (!(await consume(db, emailThrottleKey(secret, email, 'cooldown'), 60, 1)))
    return false;
  return consume(db, emailThrottleKey(secret, email, 'hour'), 3600, 5);
}
