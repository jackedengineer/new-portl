import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLiveGate } from '../../features/gate/live';
import { useSession } from '../../auth/session';
import { Copy, Screen, Title } from '../../components/ui';
import { gateRoute } from '../../features/gate/route-access';
import { VisitorQueue } from '../../features/gate/visitor-queue';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
export default function Visitors() {
  const params = useLocalSearchParams();
  const { me } = useSession();
  const { clock } = useLiveGate();
  const access = gateRoute(me, params.societyId, params.view);
  if (!access || !me) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen
      eyebrow={
        access.view === 'GUARD'
          ? 'Gate operations'
          : access.view === 'ADMIN'
            ? 'Society movement'
            : 'Your gate inbox'
      }
    >
      <Title>
        {access.view === 'GUARD'
          ? 'At the gate.'
          : access.view === 'ADMIN'
            ? 'Society visitors.'
            : 'Who’s at the gate?'}
      </Title>
      <Copy>{access.member.society.name}</Copy>
      <VisitorQueue
        key={`${me.user.id}:${access.member.society.id}:${access.view}:${params.filter ?? 'WAITING'}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        view={access.view}
        activeFilter={
          params.filter === 'HISTORY' ||
          params.filter === 'READY' ||
          params.filter === 'INSIDE'
            ? params.filter
            : 'WAITING'
        }
        onFilterChange={(filter) => router.setParams({ filter })}
      />
    </Screen>
  );
}
