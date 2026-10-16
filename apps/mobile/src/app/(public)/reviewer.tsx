import { Segments } from '../../components/task-ui';
import { useState } from 'react';
import { router } from 'expo-router';
import { reviewerSignInInput } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { authClient } from '../../lib/auth-client';
import { messageOf } from '../../lib/api';
import {
  Button,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Screen,
  Title,
} from '../../components/ui';
import { PolicyChoice, policyAcceptance } from '../../features/account/policy';

export default function Reviewer() {
  const { signedIn } = useSession();
  const [role, setRole] = useState<'RESIDENT' | 'GUARD' | 'ADMIN'>('RESIDENT');
  const [key, setKey] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    const input = reviewerSignInInput.safeParse({
      role,
      accessKey: key,
      policyAcceptance,
      reviewAcknowledged: acknowledged,
    });
    if (!accepted || !input.success || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await authClient.$fetch('/reviewer/sign-in', {
        method: 'POST',
        body: input.data,
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : 'Review access is unavailable or the key is incorrect.',
        );
      setKey('');
      await signedIn();
      router.replace('/community');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Screen back eyebrow="Store reviewer access">
      <Title>Explore a fictional society.</Title>
      <Copy>
        Use the role and reusable key provided in the store’s app access
        instructions. No email code or personal authenticator is needed.
      </Copy>
      <Copy>
        These operator-managed identities are shared. Other reviewers can see
        activity in this society, and the operator can reset it. Enter fictional
        visitor and contact details only. Email change, personal recovery and
        account deletion are unavailable for these shared identities; sign-out
        and session revocation remain available. In Account & privacy, start a
        disposable account to test email change or deletion with synthetic codes
        and no mailbox. Contact support to remove any personal information
        entered accidentally. Push is optional and uses your real device
        registration if enabled.
      </Copy>
      <Segments
        label="Reviewer role"
        options={
          [
            ['RESIDENT', 'Resident'],
            ['GUARD', 'Security guard'],
            ['ADMIN', 'Society admin'],
          ] as const
        }
        value={role}
        disabled={pending}
        onChange={(value) => {
          setRole(value);
          setKey('');
          setError('');
        }}
      />
      <Field
        label="Review access key"
        value={key}
        onChangeText={setKey}
        maxLength={43}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        secureTextEntry
        editable={!pending}
      />
      <PolicyChoice accepted={accepted} onChange={setAccepted} />
      <Choice
        role="checkbox"
        selected={acknowledged}
        label="I understand this is a shared fictional account and will use fictional data only"
        onPress={() => setAcknowledged(!acknowledged)}
      />
      <ErrorMessage message={error} />
      <Button
        label="Enter fictional society"
        pending={pending}
        disabled={
          !accepted || !acknowledged || !/^[A-Za-z0-9_-]{43}$/.test(key)
        }
        onPress={() => void submit()}
      />
    </Screen>
  );
}
