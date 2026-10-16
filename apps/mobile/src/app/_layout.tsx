import { NotificationBridge } from '../features/notifications/bridge';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../auth/session';
import {
  Button,
  colors,
  Copy,
  ErrorMessage,
  Loading,
  Screen,
} from '../components/ui';
import { NavigationProvider } from '../components/navigation/provider';
import { BottomNavigation } from '../components/navigation/bar';

function Routes() {
  const session = useSession();
  if (session.loading && !session.resolved) return <Loading />;
  const blocked = session.loading || !!session.error;
  const retry = (
    <Screen>
      <Copy>We couldn’t check your session.</Copy>
      <ErrorMessage message="Check your connection, then try again." />
      <Button label="Try again" onPress={() => void session.refresh()} />
    </Screen>
  );
  if (session.error && !session.resolved) return retry;
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, display: blocked ? 'none' : 'flex' }}
        pointerEvents={blocked ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
      >
        <View style={{ flex: 1 }}>
          <Stack
            key={session.me?.user.id ?? 'signed-out'}
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="deletion-status" />
            <Stack.Protected guard={!session.me}>
              <Stack.Screen name="(public)" />
            </Stack.Protected>
            <Stack.Protected guard={!!session.me}>
              <Stack.Screen name="account" />
            </Stack.Protected>
            <Stack.Protected
              guard={
                !!session.me &&
                !session.me.policyRequired &&
                !session.me.reviewLifecycle
              }
            >
              <Stack.Screen name="(member)" />
            </Stack.Protected>
          </Stack>
        </View>
        <BottomNavigation />
      </View>
      {session.loading ? <Loading /> : session.error ? retry : null}
    </View>
  );
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <NavigationProvider>
          <NotificationBridge />
          <Routes />
        </NavigationProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
