import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './icon';
import { colors, radii } from './theme';

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.heading}>
      {children}
    </Text>
  );
}

export function ActionRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [s.action, pressed && s.pressed]}
    >
      <View style={s.symbol}>
        <Icon name={icon} />
      </View>
      <View style={s.text}>
        <Text style={s.name}>{title}</Text>
        {detail && <Text style={s.detail}>{detail}</Text>}
      </View>
      <Icon name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

export function ActionTile({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [s.tile, pressed && s.pressed]}
    >
      <View style={s.symbol}>
        <Icon name={icon} />
      </View>
      <Text style={s.name}>{title}</Text>
      <Text style={s.detail}>{detail}</Text>
    </Pressable>
  );
}

export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={s.segments}>
      {options.map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: key === value }}
          onPress={() => onChange(key)}
          style={({ pressed }) => [
            s.segment,
            key === value && s.selected,
            pressed && s.pressed,
          ]}
        >
          <Text style={[s.segmentText, key === value && s.selectedText]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Disclosure({
  title,
  children,
  initiallyOpen = false,
}: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={s.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={s.disclosureHeading}
      >
        <Text style={s.name}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
      </Pressable>
      {open && <View style={s.disclosureContent}>{children}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  heading: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 8,
  },
  action: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  symbol: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 3 },
  name: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
  },
  detail: { fontSize: 13, lineHeight: 20, color: colors.muted },
  tile: {
    flex: 1,
    minWidth: 128,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: 16,
    gap: 10,
  },
  segments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    backgroundColor: colors.soft,
    borderRadius: radii.control,
    padding: 4,
  },
  segment: {
    flexGrow: 1,
    flexBasis: 64,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.surface },
  segmentText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  selectedText: { color: colors.ink, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disclosure: { borderTopWidth: 1, borderColor: colors.line },
  disclosureHeading: {
    flexDirection: 'row',
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  disclosureContent: { gap: 16, paddingBottom: 16 },
});
