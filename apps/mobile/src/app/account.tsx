import { ChangeEmail } from '../features/account/email-change';
import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { accountSessionsSchema } from '@portl/contracts';
import { useSession } from '../auth/session';
import { api, messageOf, successSchema } from '../lib/api';
import {
  Button,
  Card,
  Copy,
  ErrorMessage,
  Label,
  Loading,
  Screen,
  Title,
} from '../components/ui';
import {
  PolicyChoice,
  LegalLinks,
  policyAcceptance,
} from '../features/account/policy';
import { DeleteAccount } from '../features/account/deletion';
export default function Account() {
  const { me, refresh, signOut, forgetSession } = useSession();
  const [accepted, setAccepted] = useState(false);
  const sessions = useQuery({
    queryKey: ['account-sessions', me?.user.id],
    queryFn: ({ signal }) =>
      api(
        '/account/sessions',
        accountSessionsSchema,
        undefined,
        signal,
        me?.user.id,
      ),
    enabled: !!me,
  });
  const action = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
  });
  if (!me) return null;
  const run = (work: () => Promise<unknown>) => action.mutate(work);
  return (
    <Screen back eyebrow="Your account">
      <Title>Account &amp; privacy</Title>
      <Copy>{me.user.email}</Copy>
      {me.policyRequired ? (
        <Card>
          <Label>Before joining your community</Label>
          <PolicyChoice accepted={accepted} onChange={setAccepted} />
          <Button
            label="Accept & continue"
            disabled={!accepted}
            pending={action.isPending}
            onPress={() =>
              run(async () => {
                await api(
                  '/account/accept-policy',
                  successSchema,
                  policyAcceptance,
                  undefined,
                  me.user.id,
                );
                await refresh();
                router.replace('/community');
              })
            }
          />
        </Card>
      ) : (
        <LegalLinks />
      )}
      <Card>
        <Label>Signed-in devices</Label>
        <Copy small>
          Revoke a session to sign that device out. Dates help you identify
          sessions; no location tracking is used.
        </Copy>
        {sessions.isPending && <Loading label="Loading sessions…" />}
        {sessions.error ? (
          <>
            <ErrorMessage message={messageOf(sessions.error)} />
            <Button
              label="Retry sessions"
              onPress={() => void sessions.refetch()}
            />
          </>
        ) : (
          sessions.data?.items.map((session) => (
            <Card key={session.id}>
              <Label>
                {session.current ? 'This session' : 'Another session'}
              </Label>
              <Copy>
                Signed in {new Date(session.createdAt).toLocaleString()}
              </Copy>
              <Copy small>
                Expires {new Date(session.expiresAt).toLocaleString()}
              </Copy>
              <Button
                label={
                  session.current ? 'Sign out this session' : 'Revoke session'
                }
                variant="secondary"
                disabled={action.isPending}
                onPress={() =>
                  run(async () => {
                    await api(
                      '/account/sessions/revoke',
                      successSchema,
                      { sessionId: session.id },
                      undefined,
                      me.user.id,
                    );
                    if (session.current) await forgetSession();
                    else await sessions.refetch();
                  })
                }
              />
            </Card>
          ))
        )}
      </Card>
      <ChangeEmail
        key={`email-${me.user.id}`}
        userId={me.user.id}
        email={me.user.email}
      />
      <DeleteAccount
        key={me.user.id}
        userId={me.user.id}
        email={me.user.email}
      />
      <ErrorMessage message={action.error ? messageOf(action.error) : ''} />
      <Button
        label="Sign out"
        variant="quiet"
        pending={action.isPending}
        onPress={() => run(signOut)}
      />
    </Screen>
  );
}
