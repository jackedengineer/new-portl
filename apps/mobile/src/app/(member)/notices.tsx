import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../auth/session';
import { Screen, Title, Copy } from '../../components/ui';
import { noticeAccess } from '../../features/notices/access';
import { NoticeBoard } from '../../features/notices/board';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { useLiveGate } from '../../features/gate/live';
export default function Notices() {
  const p = useLocalSearchParams(),
    { me } = useSession(),
    { clock } = useLiveGate(),
    access = noticeAccess(me, p.societyId, p.view);
  if (!access || !me) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Society notice board">
      <Title>From your society office.</Title>
      <Copy>{access.member.society.name}</Copy>
      <NoticeBoard
        key={`${me.user.id}:${access.member.society.id}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        view={access.view}
      />
    </Screen>
  );
}
