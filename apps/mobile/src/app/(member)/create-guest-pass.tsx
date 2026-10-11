import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { PassCreate } from '../../features/gate/pass-create';
export default function Route() {
  const p = useLocalSearchParams(),
    { me } = useSession();
  const access = gateRoute(me, p.societyId, 'RESIDENT');

  if (!access || !me) return <Redirect href="/community" />;
  return (
    <Screen back eyebrow="Guest passes">
      <Title>Invite them in.</Title>
      <PassCreate
        key={`${me.user.id}:${access.member.society.id}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
      />
    </Screen>
  );
}
