import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { NotificationInbox } from '../../features/notifications/inbox';
export default function Notifications() {
  const { me } = useSession();
  if (!me) return null;
  return (
    <Screen back eyebrow="Your private inbox">
      <Title>At your gate.</Title>
      <NotificationInbox key={me.user.id} userId={me.user.id} />
    </Screen>
  );
}
