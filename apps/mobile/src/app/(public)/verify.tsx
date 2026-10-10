import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { useSession } from '../../auth/session';
import { authClient } from '../../lib/auth-client';
import { messageOf } from '../../lib/api';
import {
  Button,
  Copy,
  ErrorMessage,
  Field,
  Screen,
  Title,
} from '../../components/ui';

export default function Verify() {
  const { challenge, setChallenge, signedIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!challenge) return <Redirect href="/login" />;
  const cooldown = Math.max(
    0,
    Math.ceil((challenge.sentAt + 60_000 - now) / 1000),
  );
  const expired = now >= challenge.sentAt + 300_000;
  async function verify() {
    if (!challenge) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the six-digit code from your email.');
      return;
    }
    setError('');
    setPending(true);
    try {
      const result = await authClient.signIn.emailOtp({
        email: challenge.email,
        otp: code,
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Too many attempts. Please wait and try again.'
            : 'This code is invalid or has expired. Check it or request a new code.',
        );
      await signedIn();
      router.replace('/community');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  async function resend() {
    if (!challenge) return;
    setPending(true);
    setError('');
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: challenge.email,
        type: 'sign-in',
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Please wait before requesting another code.'
            : 'We couldn’t send another code. Please try again.',
        );
      setCode('');
      setChallenge({ email: challenge.email, sentAt: Date.now() });
      setNow(Date.now());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Screen back eyebrow="Check your inbox">
      <Title>A code to let you in.</Title>
      <Copy>
        We requested a sign-in code for {challenge.email}. It’s valid for five
        minutes.
      </Copy>
      <Field
        label="Six-digit email code"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={6}
        editable={!pending}
        onSubmitEditing={() => void verify()}
      />
      {expired && (
        <Copy>This code has expired. Request a new one to continue.</Copy>
      )}
      <ErrorMessage message={error} />
      <Button
        label="Verify & continue"
        pending={pending}
        disabled={expired || code.length !== 6}
        onPress={() => void verify()}
      />
      <Button
        label={cooldown ? `Resend code in ${cooldown}s` : 'Resend code'}
        variant="secondary"
        disabled={cooldown > 0 || pending}
        onPress={() => void resend()}
      />
      <Button
        label="Use a different email"
        variant="quiet"
        disabled={pending}
        onPress={() => {
          setChallenge(null);
          router.replace('/login');
        }}
      />
    </Screen>
  );
}
