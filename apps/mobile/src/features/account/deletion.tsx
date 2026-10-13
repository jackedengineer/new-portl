import { useLayoutEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  deletionChallengeSchema,
  deletionStatusSchema,
} from '@portl/contracts';
import type { z } from 'zod';
import { api, messageOf } from '../../lib/api';
import { useSession } from '../../auth/session';
import {
  Button,
  Card,
  Copy,
  ErrorMessage,
  Field,
  Label,
} from '../../components/ui';
import { saveReceipt } from './receipt';
export function DeleteAccount({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const { forgetSession } = useSession();
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [challenge, setChallenge] = useState<z.infer<
    typeof deletionChallengeSchema
  > | null>(null);
  const [otp, setOtp] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function start() {
    setPending(true);
    setError('');
    try {
      const result = await api(
        '/account/deletion/start',
        deletionChallengeSchema,
        { email },
      );
      setChallenge(result);
      setOtp('');
      setConfirmation('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  async function confirm() {
    if (!challenge || confirmation !== 'DELETE' || !/^\d{6}$/.test(otp)) return;
    setPending(true);
    setError('');
    try {
      // Preserve the recovery capability before an irreversible request, even if its response is lost.
      await saveReceipt(challenge.receiptToken);
      if (!mounted.current) return;
      await api('/account/deletion/confirm', deletionStatusSchema, {
        challengeId: challenge.challengeId,
        receiptToken: challenge.receiptToken,
        otp,
        confirmation,
        expectedUserId: userId,
      });
      if (!mounted.current) return;
      if (await forgetSession(userId)) router.replace('/deletion-status');
    } catch (e) {
      setError(
        `${messageOf(e)} If you may have confirmed already, check deletion status using your receipt.`,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <Label>Delete account</Label>
      <Copy>
        Deletion is permanent across all societies. It removes your account,
        memberships, applications, invitations, notifications, guest passes,
        notices you created and visitor records you registered, including those
        in other members’ history.
      </Copy>
      <Copy>
        If you are the only admin, society administration stops until the
        operator verifies a replacement. Unrelated society records remain with
        your identifying actor references removed.
      </Copy>
      <Copy small>
        Sessions and push registrations are revoked immediately after
        confirmation. Active database cleanup normally takes a few minutes.
        Provider backups and already-delivered messages have separate limits in
        the privacy notice.
      </Copy>
      <Button
        label={
          challenge ? 'Request another deletion code' : 'Send deletion code'
        }
        pending={pending}
        variant="secondary"
        onPress={() => void start()}
      />
      {challenge && (
        <>
          <Copy>
            A deletion code was requested for {email}. If eligible, you will
            receive a code valid for five minutes. Wait one minute before
            requesting another.
          </Copy>
          <Field
            label="Deletion email code"
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!pending}
          />
          <Field
            label="Type DELETE to confirm"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!pending}
          />
          <Field
            label="Private deletion receipt"
            value={challenge.receiptToken}
            editable={false}
            multiline
          />
          <Copy small>
            Keep this receipt private. Use “Deletion status” if your connection
            drops after confirming.
          </Copy>
          <Button
            label="Permanently delete my account"
            pending={pending}
            disabled={confirmation !== 'DELETE' || otp.length !== 6}
            onPress={() => void confirm()}
          />
        </>
      )}
      <Button
        label="Deletion status"
        variant="quiet"
        onPress={() => router.push('/deletion-status')}
      />
      <ErrorMessage message={error} />
    </Card>
  );
}
