import { Redirect, useLocalSearchParams } from 'expo-router';
import { idSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { Copy, Screen, Title } from '../../components/ui';
import { DirectoryBoard } from '../../features/administration/directory';
export default function Directory() {
  const { societyId } = useLocalSearchParams<{ societyId: string }>(),
    { me } = useSession();
  const parsed = idSchema.safeParse(societyId),
    member = me?.memberships.find(
      (m) =>
        parsed.success &&
        m.society.id === parsed.data &&
        m.roles.includes('RESIDENT') &&
        m.flats.length > 0,
    );
  if (!me || !member) return <Redirect href="/community" />;
  return (
    <Screen back eyebrow="Your community">
      <Title>Community directory.</Title>
      <Copy>{member.society.name}</Copy>
      <DirectoryBoard
        key={`${me.user.id}:${member.society.id}`}
        userId={me.user.id}
        societyId={member.society.id}
        view="RESIDENT"
      />
    </Screen>
  );
}
