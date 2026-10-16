import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { Badge, Card, Screen, Title } from '../../components/ui';
import { ActionRow, Segments } from '../../components/task-ui';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { SocietyOverview } from '../../features/administration/overview';
import { SocietyStructure } from '../../features/administration/structure';
import { SocietyResidents } from '../../features/administration/residents';
import { DirectoryBoard } from '../../features/administration/directory';
export default function SocietyOperations() {
  const { societyId, section } = useLocalSearchParams<{
      societyId: string;
      section?: string;
    }>(),
    { me } = useSession();
  const tab =
    section === 'structure' ||
    section === 'residents' ||
    section === 'directory'
      ? section
      : 'overview';
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
    <Screen eyebrow="Society administration">
      <Badge>
        {member.society.isDemo ? 'Demo society' : 'Admin access verified'}
      </Badge>
      <Title>
        {tab === 'overview'
          ? 'Your society, at a glance.'
          : 'Manage your society.'}
      </Title>
      {tab !== 'overview' && (
        <Segments
          label="Society sections"
          options={
            [
              ['overview', 'Overview'],
              ['structure', 'Towers & flats'],
              ['residents', 'Residents'],
              ['directory', 'Directory'],
            ] as const
          }
          value={tab}
          onChange={(value) => {
            router.setParams({ section: value });
          }}
        />
      )}

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
      <Card>
        <ActionRow
          icon="user-plus"
          title="Applications, invitations & gate access"
          detail="Help your community get settled"
          onPress={() =>
            router.push({
              pathname: '/admin',
              params: { societyId: member.society.id },
            })
          }
        />
        <ActionRow
          icon="file-text"
          title="Manage society notices"
          detail="Keep everyone in the loop"
          onPress={() =>
            router.push({
              pathname: '/notices',
              params: { societyId: member.society.id, view: 'ADMIN' },
            })
          }
        />
      </Card>
    </Screen>
  );
}
