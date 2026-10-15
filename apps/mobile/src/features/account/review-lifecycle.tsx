import { useLayoutEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { reviewCodeSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { authClient } from '../../lib/auth-client';
import { api, messageOf } from '../../lib/api';
import { Button, Card, Copy, ErrorMessage, Label } from '../../components/ui';

export function StartReviewLifecycle({
  userId,
  disabled = false,
}: {
  userId: string;
  disabled?: boolean;
}) {
  const { changeAccount } = useSession();
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function start(purpose: 'email-change' | 'deletion') {
    if (pending || disabled) return;
    setPending(true);
    setError('');
    try {
      await changeAccount(userId, async () => {
        const result = await authClient.$fetch('/reviewer/lifecycle', {
          method: 'POST',
          headers: { 'x-portl-expected-user': userId },
          body: { purpose },
        });
        if (result.error)
          throw new Error(
            'Disposable access is unavailable. Sign in to Reviewer access again, or wait for fixture cleanup and retry.',
          );
      });
      if (!mounted.current) return;
      router.replace('/account');
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Card>
      <Label>Test personal account lifecycle</Label>
      <Copy>
        Switch to a disposable fictional account with no society access.
        Verification codes appear inside that account; no mailbox is needed.
        Email change signs it out. Sign in to Reviewer access again to start a
        separate deletion account. Shared role accounts are preserved.
      </Copy>
      <Copy small>
        Disposable accounts expire after one hour and are automatically erased.
        Six may exist per shared role; if the limit is reached, wait for
        cleanup. Revoking this shared session also ends its disposable access.
      </Copy>
      <Button
        label="Start disposable email-change account"
        disabled={pending || disabled}
        onPress={() => void start('email-change')}
      />
      <Button
        label="Start disposable deletion account"
        disabled={pending || disabled}
        onPress={() => void start('deletion')}
      />
      <ErrorMessage message={error} />
    </Card>
  );
}
export function ReviewCode({
  userId,
  purpose,
}: {
  userId: string;
  purpose: 'verify-current-email' | 'change-email' | 'delete-account';
}) {
  const [code, setCode] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function reveal() {
    setPending(true);
    setError('');
    setCode('');
    try {
      const result = await api(
        '/account/review-code',
        reviewCodeSchema,
        { purpose },
        undefined,
        userId,
      );
      setCode(result.otp);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <Copy small>
        Disposable review delivery: enter this synthetic code in the
        verification field below. Codes expire after five minutes; request
        another if needed. Ordinary accounts receive codes by email.
      </Copy>
      <Button
        label="Show synthetic verification code"
        variant="secondary"
        pending={pending}
        onPress={() => void reveal()}
      />
      {code ? <Copy>{code}</Copy> : null}
      <ErrorMessage message={error} />
    </Card>
  );
}
