import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { useLiveGate } from '../../features/gate/live';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { PassList } from '../../features/gate/pass-list';
export default function Route() {
  const p = useLocalSearchParams(),
    { me } = useSession(),
    { clock } = useLiveGate();
  const access = gateRoute(me, p.societyId, p.view);

  if (!access || !me) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Guest passes">
      <Title>Guests, expected.</Title>
      <PassList
        key={`${me.user.id}:${access.member.society.id}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        view={access.view}
      />
    </Screen>
  );
}
