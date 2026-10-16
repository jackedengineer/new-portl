import { useState } from 'react';
import { router } from 'expo-router';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { applicationListSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { api, messageOf, successSchema } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  Copy,
  Divider,
  ErrorMessage,
  Label,
  Loading,
  Screen,
  Title,
} from '../../components/ui';

import { useCommunityNavigation } from '../../components/navigation/context';
import { resolveContext, roleLabels } from '../../components/navigation/model';
import { CommunityDashboard } from '../../features/community/dashboard';
import { ActionRow, Disclosure } from '../../components/task-ui';

const statusLabel = {
  PENDING: 'Awaiting review',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  WITHDRAWN: 'Withdrawn',
};
const reasonLabel = {
  DETAILS_COULD_NOT_BE_VERIFIED:
    'Your residency details could not be verified.',
  INCORRECT_FLAT: 'Please check your flat details with the society office.',
  CONTACT_SOCIETY_OFFICE: 'Please contact the society office.',
};
export default function Community() {
  const { me, refresh, signOut } = useSession();
  const navigation = useCommunityNavigation();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const applications = useInfiniteQuery({
    queryKey: ['applications', me?.user.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/onboarding/applications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        applicationListSchema,
        undefined,
        signal,
        me?.user.id,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!me,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) =>
      api(
        `/onboarding/applications/${id}/withdraw`,
        successSchema,
        {},
        undefined,
        me?.user.id,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['applications'] }),
  });
  if (!me) return null;
  const context = navigation
    ? navigation.context
    : resolveContext(me.memberships, {});
  const rows = applications.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Screen>
      {!context && (
        <Title>
          {me.memberships.length
            ? 'Choose your community.'
            : 'Let’s find your community.'}
        </Title>
      )}
      {me.reviewer && (
        <>
          <Badge>Shared fictional reviewer account</Badge>
          <Copy small>
            Use fictional data only. Activity is shared with other reviewers and
            may be reset by the operator.
          </Copy>
        </>
      )}
      {context && <CommunityDashboard context={context} userId={me.user.id} />}
      {!context &&
        me.memberships.map((member) => (
          <Card key={member.society.id}>
            <Label>{member.society.name}</Label>
            {member.roles.map((role) => (
              <ActionRow
                key={role}
                icon={role === 'GUARD' ? 'shield' : 'home'}
                title={roleLabels[role]}
                detail="Open this community"
                onPress={() =>
                  navigation?.select({ societyId: member.society.id, role })
                }
              />
            ))}
          </Card>
        ))}
      <Disclosure
        title="Account & community access"
        initiallyOpen={!me.memberships.length}
      >
        <Copy>Signed in as {me.user.email}</Copy>
        <ActionRow
          icon="user"
          title="Account & privacy"
          onPress={() => router.push('/account')}
        />
        <ActionRow
          icon="bell"
          title="Notifications"
          onPress={() => router.push('/notifications')}
        />
        <Card>
          <Label>
            {me.memberships.length
              ? 'Join another society'
              : 'Two ways to join'}
          </Label>
          <Copy>
            Have an invitation from your admin? Accept it here. Otherwise, apply
            using your society’s code.
          </Copy>
          <Button
            label="Accept an invitation"
            onPress={() => router.push('/invitation')}
          />
          <Button
            label="Apply to a society"
            variant="secondary"
            onPress={() => router.push('/apply')}
          />
        </Card>
        <Divider />
        <Label>Your applications</Label>
        {applications.isPending && (
          <Loading label="Checking application status…" />
        )}
        {applications.error && (
          <>
            <ErrorMessage message={messageOf(applications.error)} />
            <Button
              label="Retry applications"
              variant="secondary"
              onPress={() => void applications.refetch()}
            />
          </>
        )}
        {!applications.isPending && !applications.error && !rows.length && (
          <Copy>
            No applications yet. Once you apply, you can track the admin’s
            decision here.
          </Copy>
        )}
        {rows.map((item) => (
          <Card key={item.id}>
            <Badge>{statusLabel[item.status]}</Badge>
            <Label>{item.society.name}</Label>
            <Copy>
              {item.flat.tower} · {item.flat.label} ·{' '}
              {item.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
            </Copy>
            {item.status === 'PENDING' && (
              <>
                <Copy>
                  Your society admin will review your residency. You’ll get
                  access after approval.
                </Copy>
                <Button
                  label="Withdraw application"
                  variant="secondary"
                  pending={withdraw.isPending && withdraw.variables === item.id}
                  disabled={withdraw.isPending}
                  onPress={() => withdraw.mutate(item.id)}
                />
              </>
            )}
            {item.status === 'REJECTED' && (
              <Copy>
                {item.reason
                  ? reasonLabel[item.reason]
                  : 'Please contact your society office.'}{' '}
                You can submit a new application with the correct details.
              </Copy>
            )}
            {item.status === 'APPROVED' && (
              <Copy>
                Your request was approved. Refresh to load your society access.
              </Copy>
            )}
          </Card>
        ))}
        {applications.hasNextPage && (
          <Button
            label="Load more applications"
            variant="secondary"
            pending={applications.isFetchingNextPage}
            onPress={() => void applications.fetchNextPage()}
          />
        )}
        <ErrorMessage
          message={withdraw.error ? messageOf(withdraw.error) : ''}
        />
        <Button
          label="Refresh status"
          variant="secondary"
          onPress={() => void refresh()}
        />
      </Disclosure>
      <ErrorMessage message={error} />
      <Button
        label="Sign out"
        variant="quiet"
        onPress={() => {
          setError('');
          void signOut().catch((e) => setError(messageOf(e)));
        }}
      />
    </Screen>
  );
}
