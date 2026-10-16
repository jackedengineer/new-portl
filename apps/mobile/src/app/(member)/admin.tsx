import { useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { Segments } from '../../components/task-ui';
import { AdminGates } from '../../features/gate/admin-gates';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { AdminReviews } from '../../features/onboarding/admin-reviews';
import { AdminInvitations } from '../../features/onboarding/admin-invitations';
import { Badge, Copy, Screen, Title } from '../../components/ui';

export default function Admin() {
  const { societyId } = useLocalSearchParams<{ societyId: string }>();
  const { me } = useSession();
  const [tab, setTab] = useState<'reviews' | 'invitations' | 'gates'>(
    'reviews',
  );
  const parsed = idSchema.safeParse(societyId);
  const member = me?.memberships.find(
    (m) =>
      m.society.id === (parsed.success ? parsed.data : '') &&
      m.roles.includes('ADMIN'),
  );
  if (!member || !me) return <Redirect href="/community" />;
  if (!me.adminAssuredUntil || new Date(me.adminAssuredUntil) <= new Date())
    return <AdminStepUp societyName={member.society.name} />;
  return (
    <Screen back eyebrow="Society administration">
      <Badge>
        {member.society.isDemo ? 'Demo society' : 'Admin access verified'}
      </Badge>
      <Title>Community access.</Title>
      <Copy>{member.society.name}</Copy>
      <Segments
        label="Administration sections"
        options={
          [
            ['reviews', 'Applications'],
            ['invitations', 'Invitations'],
            ['gates', 'Gate access'],
          ] as const
        }
        value={tab}
        onChange={setTab}
      />
      {tab === 'gates' ? (
        <AdminGates userId={me.user.id} societyId={member.society.id} />
      ) : tab === 'reviews' ? (
        <AdminReviews userId={me.user.id} societyId={member.society.id} />
      ) : (
        <AdminInvitations
          userId={me.user.id}
          societyId={member.society.id}
          societyName={member.society.name}
        />
      )}
    </Screen>
  );
}
