import { useState } from 'react';
import { emailSchema } from '@portl/contracts';
import { authClient } from '../../lib/auth-client';
import { messageOf } from '../../lib/api';
import { useSession } from '../../auth/session';
import {
  Button,
  Card,
  Copy,
  ErrorMessage,
  Field,
  Label,
} from '../../components/ui';
export function ChangeEmail({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const { forgetSession } = useSession();
  const [stage, setStage] = useState<'start' | 'current' | 'new' | 'done'>(
    'start',
  );
  const [newEmail, setNewEmail] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const options = { headers: { 'x-portl-expected-user': userId } };
  async function advance() {
    setPending(true);
    setError('');
    try {
      if (stage === 'start') {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email,
          type: 'email-verification',
          fetchOptions: options,
        });
        if (result.error)
          throw new Error(
            'Could not send a current-email code. Wait a minute, then try again.',
          );
        setStage('current');
      } else if (stage === 'current') {
        const parsed = emailSchema.safeParse(newEmail);
        if (!parsed.success || parsed.data === email)
          throw new Error('Enter a different valid email address.');
        const result = await authClient.emailOtp.requestEmailChange({
          newEmail: parsed.data,
          otp: code,
          fetchOptions: options,
        });
        if (result.error)
          throw new Error(
            'Could not verify your current email. Check the code or restart this change.',
          );
        setNewEmail(parsed.data);
        setCode('');
        setStage('new');
      } else if (stage === 'new') {
        const result = await authClient.emailOtp.changeEmail({
          newEmail,
          otp: code,
          fetchOptions: options,
        });
        if (result.error)
          throw new Error(
            'Could not change your email. Check the code or restart. If the connection was interrupted, try signing in with the new address.',
          );
        setStage('done');
        await forgetSession();
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <Label>Change email</Label>
      <Copy>
        Verify {email}, then your new address. Your society memberships stay
        with your account. All sessions and push registrations are revoked after
        the change; sign in again with the new email. Pending invitations to
        your old email are removed.
      </Copy>
      {stage === 'start' ? (
        <Button
          label="Verify current email"
          variant="secondary"
          pending={pending}
          onPress={() => void advance()}
        />
      ) : (
        <>
          <Copy>
            {stage === 'current'
              ? 'Enter the code sent to your current email.'
              : 'If your new address is available, a code was requested for it. Check that inbox.'}{' '}
            Codes expire in five minutes.
          </Copy>
          {stage === 'current' && (
            <Field
              label="New email address"
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              editable={!pending}
            />
          )}
          <Field
            label={
              stage === 'current' ? 'Current email code' : 'New email code'
            }
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!pending}
          />
          <Button
            label={
              stage === 'current'
                ? 'Verify & send new email code'
                : 'Confirm email change & sign out'
            }
            disabled={code.length !== 6}
            pending={pending}
            onPress={() => void advance()}
          />
          <Button
            label="Restart email change"
            variant="quiet"
            disabled={pending}
            onPress={() => {
              setStage('start');
              setCode('');
              setError('');
            }}
          />
        </>
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}
