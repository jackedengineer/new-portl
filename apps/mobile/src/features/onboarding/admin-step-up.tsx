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
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function verify() {
    setError('');
    setPending(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code,
        trustDevice: false,
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : result.error.status === 409
              ? 'This code was already used. Wait for a new code in your authenticator.'
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
        Enter the current code from your authenticator app to manage resident
        access. This check lasts 15 minutes.
      </Copy>
      {me?.adminAuthenticatorConfigured ? (
        <>
          <Field
            label="Authenticator code"
            value={code}
            onChangeText={(value) =>
              setCode(value.replace(/\D/g, '').slice(0, 6))
            }
            keyboardType="number-pad"
            autoComplete="off"
            maxLength={6}
            editable={!pending}
            onSubmitEditing={() => void verify()}
          />
          <ErrorMessage message={error} />
          <Button
            label="Verify admin access"
            disabled={code.length !== 6}
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
        Lost your authenticator? Contact the operator for verified recovery.
        Email sign-in alone cannot unlock admin access.
      </Copy>
    </Screen>
  );
}
