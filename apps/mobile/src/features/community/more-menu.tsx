import { router } from 'expo-router';
import { Card, Copy, Label } from '../../components/ui';
import { ActionRow } from '../../components/task-ui';
import { useCommunityNavigation } from '../../components/navigation/context';

export function CommunityMenu() {
  const context = useCommunityNavigation()?.context;
  if (!context) return null;
  const { member, role } = context;
  const societyId = member.society.id;
  return (
    <Card>
      {role === 'RESIDENT' && member.flats.length > 0 && (
        <>
          <Label>Your homes</Label>
          {member.flats.map((flat) => (
            <Copy key={flat.id} small>
              {flat.tower} · {flat.label} ·{' '}
              {flat.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
            </Copy>
          ))}
        </>
      )}
      {role === 'RESIDENT' && (
        <ActionRow
          icon="users"
          title="Community directory"
          detail="Staff and service providers"
          onPress={() =>
            router.push({ pathname: '/directory', params: { societyId } })
          }
        />
      )}
      {role === 'ADMIN' && (
        <>
          <ActionRow
            icon="user-plus"
            title="Applications, invitations & gate access"
            onPress={() =>
              router.push({ pathname: '/admin', params: { societyId } })
            }
          />
          <ActionRow
            icon="clock"
            title="Society visitors & guest passes"
            onPress={() =>
              router.push({
                pathname: '/visitors',
                params: { societyId, view: role },
              })
            }
          />
        </>
      )}
      <ActionRow
        icon="bell"
        title="Notifications"
        detail="Your community inbox"
        onPress={() => router.push('/notifications')}
      />
      <ActionRow
        icon="home"
        title="Community access"
        detail="Join a society or track an application"
        onPress={() => router.push('/community')}
      />
    </Card>
  );
}
