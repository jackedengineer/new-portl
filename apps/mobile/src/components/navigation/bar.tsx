import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Icon } from '../icon';
import { colors } from '../theme';
import { useCommunityNavigation } from './context';
import { activeNavigationLabel, navigationItems } from './model';

export function BottomNavigation() {
  const nav = useCommunityNavigation();
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboard(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboard(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (!nav?.visible || !nav.context || keyboard) return null;
  const { member, role } = nav.context;
  return (
    <SafeAreaView edges={['bottom']} style={s.safe}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Main navigation"
        aria-label="Main navigation"
        style={s.tabs}
      >
        {navigationItems(role).map((item) => {
          const active =
            activeNavigationLabel(role, nav.pathname, nav.params) ===
            item.label;
          return (
            <Pressable
              key={item.label}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              aria-selected={active}
              style={({ pressed }) => [s.tab, pressed && s.pressed]}
              onPress={() =>
                router.replace({
                  pathname: item.pathname,
                  params: {
                    societyId: member.society.id,
                    view: role,
                    ...(item.filter ? { filter: item.filter } : {}),
                    ...(item.section ? { section: item.section } : {}),
                  },
                })
              }
            >
              <Icon
                name={item.icon}
                color={active ? colors.ink : colors.muted}
              />
              <Text style={[s.label, active && s.active]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  tabs: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
    textAlign: 'center',
  },
  active: { color: colors.ink, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
