import { expect, it, vi } from 'vitest';
import { expoProvider } from './provider.js';
const preview = {
  title: 'Visitor entry recorded',
  body: 'Aarav entered through Main gate.',
};
it('sends authorized contextual copy and only an opaque routing ID to the fixed Expo endpoint', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } })),
    );
  const provider = expoProvider('access-secret', fetcher);
  expect(
    await provider.send('ExpoPushToken[token]', 'notification', 90, preview),
  ).toEqual({ status: 'ok', ticketId: 'ticket' });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://exp.host/--/api/v2/push/send');
  const body = JSON.parse(init.body);
  expect(body.data).toEqual({ notificationId: 'notification' });
  expect(body.ttl).toBe(90);
  expect(body.title).toBe(preview.title);
  expect(body.body).toBe(preview.body);
  expect(JSON.stringify(body)).not.toContain('visitorName');
  expect(init.headers.Authorization).toBe('Bearer access-secret');
});
it('classifies transient HTTP errors and invalid device responses without echoing tokens', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 429 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            status: 'error',
            message: 'private token',
            details: { error: 'DeviceNotRegistered' },
          },
        }),
      ),
    );
  const provider = expoProvider(undefined, fetcher);
  expect(
    await provider.send('ExpoPushToken[token]', 'notification', 90, preview),
  ).toEqual({ status: 'retry', code: 'HTTP_RETRY' });
  expect(
    await provider.send('ExpoPushToken[token]', 'notification', 90, preview),
  ).toEqual({ status: 'error', code: 'DeviceNotRegistered' });
});
it('treats missing receipts as retryable and rejects malformed tickets', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { status: 'ok' } })),
    );
  const provider = expoProvider(undefined, fetcher);
  expect(await provider.receipt('ticket')).toEqual({
    status: 'retry',
    code: 'RECEIPT_PENDING',
  });
  expect(
    await provider.send('ExpoPushToken[token]', 'notification', 90, preview),
  ).toEqual({ status: 'retry', code: 'INVALID_RESPONSE' });
});
