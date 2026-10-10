import { Redirect } from 'expo-router';
import { useSession } from '../auth/session';
export default function Index() {
  const { me } = useSession();
  return <Redirect href={me ? '/community' : '/login'} />;
}
