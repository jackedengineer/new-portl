import { CommunityMenu } from '../features/community/more-menu';
import { StartReviewLifecycle } from '../features/account/review-lifecycle';
import { AdminRecovery } from '../features/account/recovery';
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
      {!me.policyRequired && !me.reviewLifecycle && <CommunityMenu />}
      {me.reviewer && (
        <Card>
          <Label>Shared fictional reviewer account</Label>
          <Copy>
            Use fictional data only. Activity is visible to other reviewers and
            may be reset by the operator. Email change, personal recovery and
            account deletion are unavailable for this operator-owned identity.
            Contact support to remove accidentally entered personal information.
            You can sign out or revoke sessions below.
          </Copy>
        </Card>
      )}
      {me.reviewer && (
        <StartReviewLifecycle
          key={me.user.id}
          userId={me.user.id}
          disabled={action.isPending}
        />
      )}
      {me.reviewLifecycle && (
        <Card>
          <Label>Disposable lifecycle review account</Label>
          <Copy>
            No society membership or real email delivery. This account expires
            at {new Date(me.reviewLifecycle.expiresAt).toLocaleString()} and is
            erased automatically. Email change and deletion use the same
            verification services as personal accounts. To test another flow,
            sign out and enter Reviewer access again with a shared role key.
          </Copy>
        </Card>
      )}
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
                    if (session.current) await forgetSession(me.user.id);
                    else await sessions.refetch();
                  })
                }
              />
            </Card>
          ))
        )}
      </Card>
      {!me.policyRequired && !me.reviewer && !me.reviewLifecycle && (
        <AdminRecovery key={`recovery-${me.user.id}`} userId={me.user.id} />
      )}
      {!me.reviewer && (
        <>
          {(!me.reviewLifecycle ||
            me.reviewLifecycle.purpose === 'email-change') && (
            <ChangeEmail
              key={`email-${me.user.id}`}
              userId={me.user.id}
              email={me.user.email}
              reviewNextEmail={me.reviewLifecycle?.nextEmail}
            />
          )}
          {(!me.reviewLifecycle ||
            me.reviewLifecycle.purpose === 'deletion') && (
            <DeleteAccount
              key={me.user.id}
              userId={me.user.id}
              email={me.user.email}
              disposable={!!me.reviewLifecycle}
            />
          )}
        </>
      )}
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
