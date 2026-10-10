import { afterEach, describe, expect, it, vi } from 'vitest';

import { resendDelivery } from './email.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Resend delivery boundary', () => {
  it('sends through the SDK with a bounded request lifetime', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ id: 'test-message-id' }),
    );
    vi.stubGlobal('fetch', transport);
    await resendDelivery(
      're_test_only',
      'Portl <auth@example.com>',
    )({ email: 'synthetic@example.com', otp: '123456' });
    const options = transport.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body as string).subject).toBe(
      'Your Portl sign-in code',
    );
  });

  it('does not leak provider diagnostics from a rejected send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { name: 'validation_error', message: 'private provider diagnostic' },
          { status: 422 },
        ),
      ),
    );
    await expect(
      resendDelivery(
        're_test_only',
        'Portl <auth@example.com>',
      )({ email: 'synthetic@example.com', otp: '123456' }),
    ).rejects.toThrow('Email delivery failed');
  });
});
