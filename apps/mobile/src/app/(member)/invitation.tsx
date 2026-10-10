import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { previewSchema, tokenInput } from '@portl/contracts';
import { z } from 'zod';
import { useSession } from '../../auth/session';
import { api, messageOf } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Screen,
  Title,
} from '../../components/ui';

export default function Invitation() {
  const { me, refresh } = useSession();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const preview = useMutation({
    gcTime: 0,
    mutationFn: (value: string) =>
      api('/onboarding/invitation-preview', previewSchema, { token: value }),
  });
  const accept = useMutation({
    gcTime: 0,
    mutationFn: () =>
      api(
        '/onboarding/invitation-accept',
        z.object({ societyId: z.string() }),
        { token },
      ),
    onSuccess: async () => {
      setToken('');
      preview.reset();
      await refresh();
      router.replace('/community');
    },
  });
  function check() {
    setError('');
    const parsed = tokenInput.safeParse({ token: token.trim() });
    if (!parsed.success) {
      setError('Paste the complete invitation code from your society admin.');
      return;
    }
    setToken(parsed.data.token);
    preview.mutate(parsed.data.token);
  }
  return (
    <Screen back eyebrow="Admin invitation">
      <Title>You’re invited.</Title>
      <Copy>
        Accept the invitation sent to {me?.user.email}. An invitation for a
        different email won’t work here.
      </Copy>
      {!preview.data ? (
        <>
          <Field
            label="Invitation code"
            placeholder="Paste your invitation code"
            value={token}
            onChangeText={setToken}
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={43}
            editable={!preview.isPending}
          />
          <ErrorMessage
            message={error || (preview.error ? messageOf(preview.error) : '')}
          />
          <Button
            label="Check invitation"
            pending={preview.isPending}
            onPress={check}
          />
          <Copy small>
            Invitations expire after seven days. If yours is unavailable, ask
            the admin for a new one or check that you’re using the invited
            email.
          </Copy>
        </>
      ) : (
        <>
          <Card>
            <Badge>
              {preview.data.society.isDemo
                ? 'Demo society'
                : 'Invitation ready'}
            </Badge>
            <Label>{preview.data.society.name}</Label>
            <Copy>
              {preview.data.flat.tower} · {preview.data.flat.label}
            </Copy>
            <Copy>
              Join as a resident ·{' '}
              {preview.data.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
            </Copy>
            <Copy small>
              Expires{' '}
              {new Date(preview.data.expiresAt).toLocaleDateString('en-IN')}
            </Copy>
          </Card>
          <Copy>
            Accepting gives you access to this society. You won’t need to submit
            a separate application.
          </Copy>
          <ErrorMessage message={accept.error ? messageOf(accept.error) : ''} />
          <Button
            label="Accept & join society"
            pending={accept.isPending}
            onPress={() => accept.mutate()}
          />
          <Button
            label="Use another invitation"
            variant="quiet"
            disabled={accept.isPending}
            onPress={() => {
              preview.reset();
              accept.reset();
              setToken('');
            }}
          />
        </>
      )}
    </Screen>
  );
}
