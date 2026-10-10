import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Portl
        </Text>
        <Text style={styles.description}>
          Your gate. Your neighbours. Your community.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F5F0' },
  content: { flex: 1, justifyContent: 'center', padding: 32, gap: 16 },
  title: { fontSize: 48, fontWeight: '700', color: '#163D32' },
  description: { fontSize: 20, lineHeight: 30, color: '#465A52' },
});
