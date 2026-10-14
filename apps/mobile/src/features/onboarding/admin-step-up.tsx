import { useState } from 'react';
import { useSession } from '../../auth/session';
import { authClient } from '../../lib/auth-client';
import { messageOf } from '../../lib/api';
import {
  Badge,
  Button,
  Copy,
  ErrorMessage,
  Field,
  Screen,
  Title,
} from '../../components/ui';

export function AdminStepUp({ societyName }: { societyName: string }) {
  const { me, refresh } = useSession();
  const review = me?.reviewer?.role === 'ADMIN';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function verify() {
    setError('');
    setPending(true);
    try {
      const result = review
        ? await authClient.$fetch('/reviewer/reauthenticate', {
            method: 'POST',
            headers: { 'x-portl-expected-user': me!.user.id },
            body: { accessKey: code },
          })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : result.error.status === 409
              ? 'This code was already used. Wait for a new code in your authenticator.'
              : review
                ? 'Review access is unavailable or the key is incorrect.'
                : 'We couldn’t verify this authenticator code. Try the current code.',
        );
      setCode('');
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Screen back eyebrow="Society administration">
      <Badge>{societyName}</Badge>
      <Title>One more check.</Title>
      <Copy>
        {review
          ? 'Enter the admin review key to continue managing this fictional society.'
          : 'Enter the current code from your authenticator app to manage resident access.'}{' '}
        This check lasts 15 minutes.
      </Copy>
      {review || me?.adminAuthenticatorConfigured ? (
        <>
          <Field
            label={review ? 'Review access key' : 'Authenticator code'}
            value={code}
            onChangeText={(value) =>
              setCode(review ? value : value.replace(/\D/g, '').slice(0, 6))
            }
            keyboardType={review ? 'default' : 'number-pad'}
            secureTextEntry={review}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={review ? 43 : 6}
            editable={!pending}
            onSubmitEditing={() => void verify()}
          />
          <ErrorMessage message={error} />
          <Button
            label="Verify admin access"
            disabled={
              review ? !/^[A-Za-z0-9_-]{43}$/.test(code) : code.length !== 6
            }
            pending={pending}
            onPress={() => void verify()}
          />
        </>
      ) : (
        <Copy>
          Your authenticator has not been configured. Contact the Portl operator
          to complete administrator setup.
        </Copy>
      )}
      <Copy small>
        {review
          ? 'Review keys are managed by the operator. This access is limited to the fictional society.'
          : 'Lost your authenticator? Contact the operator for verified recovery. Email sign-in alone cannot unlock admin access.'}
      </Copy>
    </Screen>
  );
}
