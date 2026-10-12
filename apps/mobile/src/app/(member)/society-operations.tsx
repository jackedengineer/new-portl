import { useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { Badge, Button, Copy, Row, Screen, Title } from '../../components/ui';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { SocietyOverview } from '../../features/administration/overview';
import { SocietyStructure } from '../../features/administration/structure';
import { SocietyResidents } from '../../features/administration/residents';
import { DirectoryBoard } from '../../features/administration/directory';
export default function SocietyOperations() {
  const { societyId } = useLocalSearchParams<{ societyId: string }>(),
    { me } = useSession();
  const [tab, setTab] = useState<
    'overview' | 'structure' | 'residents' | 'directory'
  >('overview');
  const parsed = idSchema.safeParse(societyId),
    member = me?.memberships.find(
      (m) =>
        parsed.success &&
        m.society.id === parsed.data &&
        m.roles.includes('ADMIN'),
    );
  if (!me || !member) return <Redirect href="/community" />;
  if (!me.adminAssuredUntil || new Date(me.adminAssuredUntil) <= new Date())
    return <AdminStepUp societyName={member.society.name} />;
  const props = { userId: me.user.id, societyId: member.society.id };
  return (
    <Screen back eyebrow="Society administration">
      <Badge>
        {member.society.isDemo ? 'Demo society' : 'Admin access verified'}
      </Badge>
      <Title>Manage your society.</Title>
      <Copy>{member.society.name}</Copy>
      <Row>
        {(
          [
            ['overview', 'Overview'],
            ['structure', 'Towers & flats'],
            ['residents', 'Residents'],
            ['directory', 'Directory'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            label={label}
            variant={tab === value ? 'primary' : 'secondary'}
            onPress={() => setTab(value)}
          />
        ))}
      </Row>
      <Button
        label="Applications, invitations & gate access"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/admin',
            params: { societyId: member.society.id },
          })
        }
      />
      <Button
        label="Manage society notices"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/notices',
            params: { societyId: member.society.id, view: 'ADMIN' },
          })
        }
      />
      {tab === 'overview' ? (
        <SocietyOverview
          key={`${me.user.id}:${member.society.id}:overview`}
          {...props}
        />
      ) : tab === 'structure' ? (
        <SocietyStructure
          key={`${me.user.id}:${member.society.id}:structure`}
          {...props}
        />
      ) : tab === 'residents' ? (
        <SocietyResidents
          key={`${me.user.id}:${member.society.id}:residents`}
          {...props}
        />
      ) : (
        <DirectoryBoard
          key={`${me.user.id}:${member.society.id}:directory`}
          {...props}
          view="ADMIN"
        />
      )}
    </Screen>
  );
}
