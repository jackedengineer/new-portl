import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

export const colors = {
  background: '#F6F5F0',
  surface: '#FFFFFF',
  ink: '#173D32',
  muted: '#53665E',
  line: '#D9DFD7',
  accent: '#B74928',
  soft: '#E8EDE5',
  error: '#A62F24',
};
export function Screen({
  children,
  back = false,
  eyebrow,
}: {
  children: ReactNode;
  back?: boolean;
  eyebrow?: string;
}) {
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={s.top}>
            <Text style={s.wordmark}>
              portl<Text style={s.dot}>.</Text>
            </Text>
            {back && (
              <Button
                label="Back"
                variant="quiet"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace('/')
                }
              />
            )}
          </View>
          {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}
export function Copy({
  children,
  small = false,
}: {
  children: ReactNode;
  small?: boolean;
}) {
  return <Text style={[s.copy, small && s.small]}>{children}</Text>;
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}
export function Badge({ children }: { children: ReactNode }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{children}</Text>
    </View>
  );
}
export function Divider() {
  return <View style={s.divider} />;
}
export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[s.input, error ? s.inputError : null]}
        {...props}
      />
      {error && <ErrorMessage message={error} />}
    </View>
  );
}
export function ErrorMessage({ message }: { message?: string | null }) {
  return message ? (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={s.error}
    >
      {message}
    </Text>
  ) : null;
}
export function Button({
  label,
  onPress,
  pending = false,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      disabled={disabled || pending}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'primary'
          ? s.primary
          : variant === 'secondary'
            ? s.secondary
            : s.quiet,
        (disabled || pending) && s.disabled,
        pressed && s.pressed,
      ]}
    >
      {pending && (
        <ActivityIndicator
          color={variant === 'primary' ? colors.surface : colors.ink}
        />
      )}
      <Text style={[s.buttonText, variant === 'primary' && s.primaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Loading({
  label = 'Loading your community…',
}: {
  label?: string;
}) {
  return (
    <View style={s.loading}>
      <ActivityIndicator size="large" color={colors.ink} />
      <Copy>{label}</Copy>
    </View>
  );
}
export function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[s.choice, selected && s.choiceActive]}
    >
      <Text style={s.choiceText}>
        {selected ? '●  ' : '○  '}
        {label}
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 20,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    paddingBottom: 40,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  wordmark: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: colors.ink,
  },
  dot: { color: colors.accent },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.ink,
  },
  copy: { fontSize: 16, lineHeight: 25, color: colors.muted },
  small: { fontSize: 13, lineHeight: 20 },
  card: {
    padding: 20,
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.ink },
  fieldGroup: { gap: 8 },
  input: {
    minHeight: 54,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 17,
  },
  inputError: { borderColor: colors.error },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  button: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primary: { backgroundColor: colors.ink },
  secondary: {
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quiet: { paddingHorizontal: 4 },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  primaryText: { color: colors.surface },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.ink,
    textTransform: 'uppercase',
  },
  divider: { height: 1, backgroundColor: colors.line },
  loading: {
    flex: 1,
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 16,
    minHeight: 52,
    backgroundColor: colors.surface,
  },
  choiceActive: { borderColor: colors.ink, backgroundColor: colors.soft },
  choiceText: { fontSize: 16, color: colors.ink },
});
