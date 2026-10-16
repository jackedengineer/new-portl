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
import { colors, radii, spacing } from './theme';
import { Icon, type IconName } from './icon';
import { AppHeader } from './navigation/header';
import { useCommunityNavigation } from './navigation/context';

export { colors } from './theme';
export function Screen({
  children,
  back = false,
  eyebrow,
}: {
  children: ReactNode;
  back?: boolean;
  eyebrow?: string;
}) {
  const navigation = useCommunityNavigation();
  return (
    <SafeAreaView
      style={s.safe}
      edges={navigation?.visible ? ['top', 'left', 'right'] : undefined}
    >
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <AppHeader back={back} />
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
export function Card({
  children,
  tone = 'surface',
}: {
  children: ReactNode;
  tone?: 'surface' | 'soft';
}) {
  return (
    <View style={[s.card, tone === 'soft' && s.softCard]}>{children}</View>
  );
}
export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <View
      style={[
        s.badge,
        tone === 'warning' && s.warningBadge,
        tone === 'danger' && s.dangerBadge,
      ]}
    >
      <Text
        style={[
          s.badgeText,
          tone === 'warning' && s.warningText,
          tone === 'danger' && s.error,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export function Divider() {
  return <View style={s.divider} />;
}
export function Field({
  label,
  error,
  style,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[s.input, error ? s.inputError : null, style]}
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
  icon,
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      disabled={disabled || pending}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'primary'
          ? s.primary
          : variant === 'danger'
            ? s.danger
            : variant === 'secondary'
              ? s.secondary
              : s.quiet,
        (disabled || pending) && s.disabled,
        pressed && s.pressed,
      ]}
    >
      {pending && (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'danger'
              ? colors.surface
              : colors.ink
          }
        />
      )}
      {!pending && icon && (
        <Icon
          name={icon}
          color={
            variant === 'primary' || variant === 'danger'
              ? colors.surface
              : colors.ink
          }
        />
      )}
      <Text
        style={[
          s.buttonText,
          (variant === 'primary' || variant === 'danger') && s.primaryText,
        ]}
      >
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
  role = 'radio',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'radio' | 'checkbox';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      style={[s.choice, selected && s.choiceActive]}
    >
      <Icon
        name={
          role === 'checkbox'
            ? selected
              ? 'check-square'
              : 'square'
            : selected
              ? 'check-circle'
              : 'circle'
        }
        size={20}
      />
      <Text style={s.choiceText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing.lg,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    paddingBottom: 40,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.8,
    color: colors.ink,
  },
  copy: { fontSize: 15, lineHeight: 23, color: colors.muted },
  small: { fontSize: 13, lineHeight: 20 },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
  },
  softCard: { backgroundColor: colors.soft, borderColor: colors.soft },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.ink },
  fieldGroup: { gap: 8 },
  input: {
    minHeight: 50,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 16,
  },
  inputError: { borderColor: colors.error },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  button: {
    minHeight: 50,
    borderRadius: radii.control,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primary: { backgroundColor: colors.ink },
  danger: { backgroundColor: colors.error },
  secondary: {
    backgroundColor: colors.soft,
  },
  quiet: { paddingHorizontal: 4 },
  buttonText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'center',
  },
  primaryText: { color: colors.surface },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  warningBadge: { backgroundColor: colors.warningSurface },
  dangerBadge: { backgroundColor: colors.errorSurface },
  warningText: { color: colors.warning },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
    color: colors.ink,
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
    borderRadius: radii.control,
    padding: spacing.md,
    minHeight: 52,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  choiceActive: { borderColor: colors.ink, backgroundColor: colors.soft },
  choiceText: { fontSize: 15, lineHeight: 22, color: colors.ink, flex: 1 },
});
