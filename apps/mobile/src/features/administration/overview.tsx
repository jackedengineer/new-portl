import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../components/theme';
import { useQuery } from '@tanstack/react-query';
import { administrationSummarySchema } from '@portl/contracts';
import { Button, Copy, ErrorMessage, Loading } from '../../components/ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { operationKey, useOperationRequest } from './request';
export function SocietyOverview({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const request = useOperationRequest(userId, societyId),
    { enabled } = useLiveGate();
  const query = useQuery({
    queryKey: [...operationKey(userId, societyId), 'overview'],
    queryFn: ({ signal }) =>
      request.call(
        '/administration/summary',
        administrationSummarySchema,
        undefined,
        signal,
      ),
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: 'always',
  });
  const labels = {
    towers: 'Active towers',
    flats: 'Active flats',
    residents: 'Current residents',
    gates: 'Active gates',
    guards: 'Assigned guards',
    staff: 'Staff contacts',
    serviceProviders: 'Service providers',
  };
  return (
    <>
      {query.isPending && <Loading label="Loading society overview…" />}
      {query.error && <ErrorMessage message={messageOf(query.error)} />}
      {!query.error && query.data && (
        <>
          <View style={s.hero}>
            <Text style={s.heroLabel}>COMMUNITY ACCESS</Text>
            <Text accessibilityRole="header" style={s.heroTitle}>
              {query.data.pendingApplications === 0
                ? 'No applications waiting.'
                : `${query.data.pendingApplications} application${query.data.pendingApplications === 1 ? '' : 's'} awaiting review.`}
            </Text>
            <Text style={s.heroCopy}>
              Pending applications from people joining your society.
            </Text>
            <Button
              label="Review applications"
              icon="arrow-right"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/admin', params: { societyId } })
              }
            />
          </View>
          <Copy>Society access and community contacts, in one place.</Copy>
          <View style={s.metrics}>
            {Object.entries(labels).map(([key, label]) => (
              <View key={key} style={s.metric}>
                <Text style={s.value}>
                  {query.data[key as keyof typeof labels]}
                </Text>
                <Text style={s.caption}>{label}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      <Button
        label="Refresh overview"
        variant="secondary"
        onPress={() => void query.refetch()}
      />
    </>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 24, gap: 12 },
  heroLabel: {
    color: colors.surface,
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: 1,
    fontWeight: '600',
  },
  heroTitle: {
    color: colors.surface,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  heroCopy: { color: '#D7E4D9', fontSize: 13, lineHeight: 20 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 20,
    gap: 8,
  },
  value: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  caption: { fontSize: 13, lineHeight: 20, color: colors.muted },
});
