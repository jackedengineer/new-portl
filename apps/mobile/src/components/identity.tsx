import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './icon';
import { colors } from './theme';

export function Identity({ title, icon }: { title: string; icon: IconName }) {
  return <View style={s.row}>
    <View style={s.icon}><Icon name={icon} size={24} /></View>
    <Text accessibilityRole="header" style={s.title}>{title}</Text>
  </View>;
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: '600', letterSpacing: -0.3 },
});
