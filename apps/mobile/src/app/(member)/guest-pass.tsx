import { Redirect, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { useLiveGate } from '../../features/gate/live';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { PassDetail } from '../../features/gate/pass-detail';
export default function Route() {
  const p = useLocalSearchParams(),
    { me } = useSession(),
    { clock } = useLiveGate();
  const access = gateRoute(me, p.societyId, p.view);
  const id = idSchema.safeParse(p.id);
  if (!access || !me || !id.success) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Guest passes">
      <Title>A visit, planned.</Title>
      <PassDetail
        key={`${me.user.id}:${access.member.society.id}:${access.view}${id.data}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        id={id.data}
        view={access.view}
      />
    </Screen>
  );
}
