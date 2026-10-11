import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { Registration } from '../../features/gate/registration';
export default function RegisterVisitor() {
  const p = useLocalSearchParams();
  const { me } = useSession();
  const access = gateRoute(me, p.societyId, 'GUARD');
  if (!access || !me) return <Redirect href="/community" />;
  return (
    <Screen back eyebrow="Gate operations">
      <Title>Someone’s here.</Title>
      <Registration
        key={`${me.user.id}:${access.member.society.id}`}
        userId={me.user.id}
        societyId={access.member.society.id}
      />
    </Screen>
  );
}
