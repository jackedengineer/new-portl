import { idSchema } from '@portl/contracts';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useLiveGate } from '../../features/gate/live';
import { useSession } from '../../auth/session';
import { Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { VisitDetail } from '../../features/gate/visit-detail';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
export default function Visitor() {
  const p = useLocalSearchParams();
  const { me } = useSession();
  const { clock } = useLiveGate();
  const access = gateRoute(me, p.societyId, p.view);
  const id = idSchema.safeParse(p.id);
  if (!access || !me || !id.success) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Visitor details">
      <Title>Keep the gate in sync.</Title>
      <VisitDetail
        key={`${me.user.id}:${access.member.society.id}:${id.data}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        id={id.data}
        view={access.view}
      />
    </Screen>
  );
}
