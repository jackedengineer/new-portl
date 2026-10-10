import { Resend } from 'resend';

import type { OtpDelivery } from './auth.js';

export function resendDelivery(apiKey: string, from: string): OtpDelivery {
  const resend = new Resend(apiKey);
  return async ({ email, otp }) => {
    const { error } = await resend.emails.send(
      {
        from,
        to: email,
        subject: 'Your Portl sign-in code',
        text: `Your Portl sign-in code is ${otp}. It expires in 5 minutes.\n\nDo not share this code. Portl staff will never ask for it. If you did not request it, ignore this email.`,
      },
      { signal: AbortSignal.timeout(10_000) },
    );
    if (error) throw new Error('Email delivery failed');
  };
}
