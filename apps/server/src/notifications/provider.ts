import { z } from 'zod';
import type { NotificationPreview } from '@portl/contracts';
export type PushResult =
  | { status: 'ok'; ticketId?: string }
  | { status: 'retry'; code: string }
  | { status: 'error'; code: string };
const resultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    id: z.string().min(1).max(100).optional(),
  }),
  z.object({
    status: z.literal('error'),
    details: z.object({ error: z.string().max(100) }).optional(),
  }),
]);
const codes = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
]);
export function expoProvider(
  accessToken?: string,
  fetcher: typeof fetch = fetch,
) {
  async function post(path: 'send' | 'getReceipts', body: object) {
    try {
      const response = await fetcher(
        `https://exp.host/--/api/v2/push/${path}`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (response.status === 429 || response.status >= 500)
        return {
          failed: { status: 'retry', code: 'HTTP_RETRY' } as PushResult,
        };
      if (!response.ok)
        return {
          failed: { status: 'error', code: 'HTTP_REJECTED' } as PushResult,
        };
      const raw = await response.text();
      if (raw.length > 65536)
        return {
          failed: { status: 'retry', code: 'INVALID_RESPONSE' } as PushResult,
        };
      return { data: JSON.parse(raw) as unknown };
    } catch {
      return {
        failed: { status: 'retry', code: 'NETWORK_ERROR' } as PushResult,
      };
    }
  }
  function parse(input: unknown, ticket: boolean): PushResult {
    const parsed = resultSchema.safeParse(input);
    if (!parsed.success) return { status: 'retry', code: 'INVALID_RESPONSE' };
    const value = parsed.data;
    if (value.status === 'ok')
      return ticket
        ? value.id
          ? { status: 'ok', ticketId: value.id }
          : { status: 'retry', code: 'INVALID_RESPONSE' }
        : { status: 'ok' };
    const raw = value.details?.error;
    const code = raw && codes.has(raw) ? raw : 'PROVIDER_ERROR';
    return {
      status:
        code === 'MessageRateExceeded' || code === 'PROVIDER_ERROR'
          ? 'retry'
          : 'error',
      code,
    };
  }
  return {
    async send(
      token: string,
      notificationId: string,
      ttl: number,
      preview: NotificationPreview,
    ): Promise<PushResult> {
      const result = await post('send', {
        to: token,
        title: preview.title,
        body: preview.body,
        data: { notificationId },
        channelId: 'gate',
        sound: 'default',
        priority: 'high',
        ttl: Math.max(1, Math.min(86400, Math.floor(ttl))),
      });
      if (result.failed) return result.failed;
      const envelope = z.object({ data: z.unknown() }).safeParse(result.data);
      return parse(envelope.success ? envelope.data.data : undefined, true);
    },
    async receipt(id: string): Promise<PushResult> {
      const result = await post('getReceipts', { ids: [id] });
      if (result.failed) return result.failed;
      const envelope = z
        .object({ data: z.record(z.string(), z.unknown()) })
        .safeParse(result.data);
      if (!envelope.success)
        return { status: 'retry', code: 'INVALID_RESPONSE' };
      if (!(id in envelope.data.data))
        return { status: 'retry', code: 'RECEIPT_PENDING' };
      return parse(envelope.data.data[id], false);
    },
  };
}
export type PushProvider = ReturnType<typeof expoProvider>;
