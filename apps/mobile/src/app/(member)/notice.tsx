import { Redirect, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';
import { useSession } from '../../auth/session';
import { Screen, Copy } from '../../components/ui';
import { noticeAccess } from '../../features/notices/access';
import { NoticeDetail } from '../../features/notices/detail';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { useLiveGate } from '../../features/gate/live';
export default function Notice() {
  const p = useLocalSearchParams(),
    { me } = useSession(),
    { clock } = useLiveGate(),
    access = noticeAccess(me, p.societyId, p.view),
    id = z.uuid().safeParse(p.id);
  if (!access || !me || !id.success) return <Redirect href="/community" />;
  if (
    access.view === 'ADMIN' &&
    (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
  )
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Society notice">
      <Copy>{access.member.society.name}</Copy>
      <NoticeDetail
        key={`${me.user.id}:${access.member.society.id}:${id.data}:${access.view}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        id={id.data}
        view={access.view}
      />
    </Screen>
  );
}
