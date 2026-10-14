import { PolicyChoice } from '../../features/account/policy';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { emailSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { authClient } from '../../lib/auth-client';
import { messageOf } from '../../lib/api';
import {
  Button,
  colors,
  Copy,
  ErrorMessage,
  Field,
  Screen,
  Title,
} from '../../components/ui';

export default function Login() {
  const [accepted, setAccepted] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const { setChallenge } = useSession();
  async function submit() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }
    if (!accepted) {
      setError('Confirm your age and accept the terms and privacy notice.');
      return;
    }
    setError('');
    setPending(true);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: parsed.data,
        type: 'sign-in',
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Please wait before requesting another code.'
            : 'We couldn’t send a code. Please try again.',
        );
      setChallenge({ email: parsed.data, sentAt: Date.now() });
      router.push('/verify');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Screen eyebrow="A little closer to home">
      <View
        style={s.scene}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={s.building}>
          <View style={s.windows}>
            {Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={s.window} />
            ))}
          </View>
          <View style={s.door} />
        </View>
        <View style={s.gate} />
        <View style={s.tree} />
        <View style={s.ground} />
        <Text style={s.sceneLabel}>YOUR COMMUNITY, CONNECTED</Text>
      </View>
      <Title>Your gate. Your people. Your Portl.</Title>
      <Copy>The everyday conversations of your society, all in one place.</Copy>
      <Field
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        maxLength={254}
        editable={!pending}
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />
      <PolicyChoice accepted={accepted} onChange={setAccepted} />
      <ErrorMessage message={error} />
      <Button
        label="Continue with email"
        pending={pending}
        onPress={() => void submit()}
      />
      <Button
        label="Reviewer access"
        variant="quiet"
        disabled={pending}
        onPress={() => router.push('/reviewer')}
      />
      <Button
        label="Deletion status"
        variant="quiet"
        onPress={() => router.push('/deletion-status')}
      />
      <Copy small>
        We’ll send a six-digit sign-in code. Your society admin confirms your
        community access.
      </Copy>
    </Screen>
  );
}
const s = StyleSheet.create({
  scene: {
    height: 196,
    backgroundColor: '#E8EDE5',
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  building: {
    position: 'absolute',
    left: 48,
    bottom: 40,
    width: 120,
    height: 140,
    backgroundColor: '#C9D4C7',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  windows: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 20 },
  window: { width: 18, height: 20, backgroundColor: colors.ink },
  door: {
    position: 'absolute',
    bottom: 0,
    left: 48,
    width: 26,
    height: 30,
    backgroundColor: colors.ink,
  },
  gate: {
    position: 'absolute',
    left: 168,
    bottom: 40,
    height: 52,
    width: 84,
    borderWidth: 5,
    borderColor: colors.ink,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  tree: {
    position: 'absolute',
    right: 24,
    bottom: 40,
    width: 40,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#879D81',
  },
  ground: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 38,
    height: 2,
    backgroundColor: colors.ink,
  },
  sceneLabel: {
    position: 'absolute',
    bottom: 14,
    left: 24,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.ink,
  },
});
