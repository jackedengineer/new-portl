import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { PassVerify } from '../../features/gate/pass-verify';
export default function Route() {
  const p = useLocalSearchParams(),
    { me } = useSession();
  const access = gateRoute(me, p.societyId, 'GUARD');

  if (!access || !me) return <Redirect href="/community" />;
  return (
    <Screen back eyebrow="Guest passes">
      <Title>Welcome at the gate.</Title>
      <PassVerify
        key={`${me.user.id}:${access.member.society.id}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
      />
    </Screen>
  );
}
