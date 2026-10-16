import type { VisitorRequest } from '@portl/contracts';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Copy, Card, Label } from '../../components/ui';
import { Icon } from '../../components/icon';
import { colors } from '../../components/theme';
import { categoryLabel } from './visitor-card';

export function QueueSummary({
  items,
  societyId,
}: {
  items: VisitorRequest[];
  societyId: string;
}) {
  const visitor = items[0];
  if (!visitor)
    return (
      <Card tone="soft">
        <Icon name="shield" />
        <Label>Your gate is all clear.</Label>
        <Copy small>Requests for your flat will appear here.</Copy>
      </Card>
    );
  return (
    <View style={s.hero}>
      <View style={s.top}>
        <Icon name="bell" color={colors.surface} />
        <Text style={s.eyebrow}>AWAITING YOUR RESPONSE</Text>
      </View>
      <Text accessibilityRole="header" style={s.title}>
        {visitor.visitorName} is at the gate.
      </Text>
      <Text style={s.detail}>
        {categoryLabel[visitor.category]}
        {visitor.company ? ` · ${visitor.company}` : ''}
      </Text>
      <Text style={s.detail}>
        {visitor.flat.tower} · {visitor.flat.label} · {visitor.gate.name}
      </Text>
      <View style={s.action}>
        <Button
          label="Review visitor request"
          variant="secondary"
          icon="arrow-right"
          onPress={() =>
            router.push({
              pathname: '/visitor',
              params: { societyId, id: visitor.id, view: 'RESIDENT' },
            })
          }
        />
      </View>
      {items.length > 1 && (
        <Text style={s.detail}>
          More requests are waiting in your gate inbox.
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 24, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: {
    color: colors.surface,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 1,
    fontWeight: '600',
    flexShrink: 1,
  },
  title: {
    color: colors.surface,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  detail: { color: '#D7E4D9', fontSize: 13, lineHeight: 20 },
  action: { marginTop: 8 },
});
