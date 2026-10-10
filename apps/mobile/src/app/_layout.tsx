import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../auth/session';
import { Button, Copy, ErrorMessage, Loading, Screen } from '../components/ui';

function Routes() {
  const session = useSession();
  if (session.loading) return <Loading />;
  if (session.error)
    return (
      <Screen>
        <Copy>We couldn’t check your session.</Copy>
        <ErrorMessage message="Check your connection, then try again." />
        <Button label="Try again" onPress={() => void session.refresh()} />
      </Screen>
    );
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!session.me}>
        <Stack.Screen name="(public)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session.me}>
        <Stack.Screen name="(member)" />
      </Stack.Protected>
    </Stack>
  );
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
