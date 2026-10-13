import { Resend } from 'resend';

import type { OtpDelivery } from './auth.js';

export function resendDelivery(apiKey: string, from: string): OtpDelivery {
  const resend = new Resend(apiKey);
  return async ({ email, otp, purpose = 'sign-in' }) => {
    const action =
      purpose === 'admin-recovery'
        ? 'admin recovery'
        : purpose === 'delete-account'
          ? 'account deletion'
          : purpose === 'verify-current-email'
            ? 'current email verification'
            : purpose === 'change-email'
              ? 'email change'
              : 'sign-in';
    const { error } = await resend.emails.send(
      {
        from,
        to: email,
        subject: `Your Portl ${action} code`,
        text:
          purpose === 'admin-recovery'
            ? `Your Portl admin recovery code is ${otp}. It expires in 5 minutes. An operator prepared a recovery request after identity checks. If you requested this, sign in to Portl and open Account & privacy to enroll and verify your new authenticator. Enter this code only in the app. Never share it with an operator or anyone else. If you did not request recovery, contact support and do not use this code.`
            : `Your Portl ${action} code is ${otp}. It expires in 5 minutes.${purpose === 'delete-account' ? '\nUse this code only if you want to permanently delete your Portl account and associated content.' : ''}\n\nDo not share this code. Portl staff will never ask for it. If you did not request it, ignore this email.`,
      },
      { signal: AbortSignal.timeout(10_000) },
    );
    if (error) throw new Error('Email delivery failed');
  };
}
