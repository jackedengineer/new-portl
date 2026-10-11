import { useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { AdminGates } from '../../features/gate/admin-gates';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { AdminReviews } from '../../features/onboarding/admin-reviews';
import { AdminInvitations } from '../../features/onboarding/admin-invitations';
import { Badge, Button, Copy, Row, Screen, Title } from '../../components/ui';

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
      <Title>Open the door to your community.</Title>
      <Copy>{member.society.name}</Copy>
      <Row>
        <Button
          label="Applications"
          variant={tab === 'reviews' ? 'primary' : 'secondary'}
          onPress={() => setTab('reviews')}
        />
        <Button
          label="Invitations"
          variant={tab === 'invitations' ? 'primary' : 'secondary'}
          onPress={() => setTab('invitations')}
        />
        <Button
          label="Gate access"
          variant={tab === 'gates' ? 'primary' : 'secondary'}
          onPress={() => setTab('gates')}
        />
      </Row>
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
