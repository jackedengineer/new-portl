import { Redirect, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';
import { useSession } from '../../auth/session';
import { Screen, Title, Copy } from '../../components/ui';
import { noticeAccess } from '../../features/notices/access';
import { NoticeEditor } from '../../features/notices/editor';
import { AdminStepUp } from '../../features/onboarding/admin-step-up';
import { useLiveGate } from '../../features/gate/live';
export default function EditNotice() {
  const p = useLocalSearchParams(),
    { me } = useSession(),
    { clock } = useLiveGate(),
    access = noticeAccess(me, p.societyId, 'ADMIN'),
    id = p.id === undefined ? undefined : z.uuid().safeParse(p.id);
  if (!access || !me || (id && !id.success))
    return <Redirect href="/community" />;
  if (!me.adminAssuredUntil || Date.parse(me.adminAssuredUntil) <= clock)
    return <AdminStepUp societyName={access.member.society.name} />;
  return (
    <Screen back eyebrow="Society administration">
      <Title>{id ? 'Edit your draft.' : 'A new society update.'}</Title>
      <Copy>{access.member.society.name}</Copy>
      <NoticeEditor
        key={`${me.user.id}:${access.member.society.id}:${id?.data ?? 'new'}`}
        userId={me.user.id}
        societyId={access.member.society.id}
        id={id?.data}
      />
    </Screen>
  );
}
