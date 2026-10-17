import { RefreshButton } from '../../components/refresh-button';
import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  visitorListSchema,
  type GateFilter,
  type GateView,
} from '@portl/contracts';
import { api, messageOf } from '../../lib/api';
import {
  Button,
  Copy,
  ErrorMessage,
  Label,
  Loading,
  Row,
} from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
import { useGateSocket } from './socket';
import { VisitorCard } from './visitor-card';
import { QueueSummary } from './queue-summary';
import { Segments } from '../../components/task-ui';
const filters: Record<GateFilter, string> = {
  WAITING: 'Waiting',
  READY: 'Ready',
  INSIDE: 'Inside',
  HISTORY: 'History',
};
export function VisitorQueue({
  userId,
  societyId,
  view,
  activeFilter,
  onFilterChange,
  presentation = 'full',
}: {
  userId: string;
  societyId: string;
  view: GateView;
  activeFilter?: GateFilter;
  onFilterChange?: (filter: GateFilter) => void;
  presentation?: 'full' | 'summary';
}) {
  const live = useLiveGate();
  const connected = useGateSocket(userId, societyId, view, live.enabled);
  const [selectedFilter, setFilter] = useState<GateFilter>('WAITING');
  const filter = activeFilter ?? selectedFilter;
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const cursor = pages.at(-1);
  const query = useQuery({
    queryKey: [...gateKey(userId, societyId), 'queue', view, filter, cursor],
    queryFn: ({ signal }) =>
      api(
        gatePath(
          societyId,
          `requests?view=${view}&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        ),
        visitorListSchema,
        undefined,
        signal,
        userId,
      ),
    enabled: live.enabled,
    refetchInterval: live.enabled ? (connected ? 60_000 : 30_000) : false,
    staleTime: 0,
  });
  if (presentation === 'summary')
    return (
      <>
        {query.isPending && <Loading label="Checking the gate…" />}
        <ErrorMessage message={query.error ? messageOf(query.error) : null} />
        {!query.isPending && !query.error && (
          <QueueSummary items={query.data?.items ?? []} societyId={societyId} />
        )}
        {!live.online && (
          <Copy small>
            You’re offline. Reconnect to get current gate status.
          </Copy>
        )}
        {query.error && (
          <RefreshButton
            label="Retry visitors"
            variant="secondary"
            disabled={query.isFetching}
            onRefresh={() => query.refetch()}
          />
        )}
      </>
    );
  return (
    <>
      {view === 'GUARD' && (
        <Button
          label="Register visitor"
          icon="user-plus"
          onPress={() =>
            router.push({
              pathname: '/register-visitor',
              params: { societyId },
            })
          }
        />
      )}
      <Button
        label="Guest passes"
        icon="credit-card"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/guest-passes',
            params: { societyId, view },
          })
        }
      />
      {view === 'GUARD' && (
        <Button
          label="Verify guest pass"
          icon="check-circle"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/verify-guest-pass',
              params: { societyId },
            })
          }
        />
      )}
      <Segments
        label="Visitor status"
        options={(Object.keys(filters) as GateFilter[]).map(
          (key) => [key, filters[key]] as const,
        )}
        value={filter}
        onChange={(key) => {
          setFilter(key);
          onFilterChange?.(key);
          setPages([undefined]);
        }}
      />
      <Copy small>
        {!live.online
          ? 'You’re offline. Reconnect to get current gate status.'
          : query.error
            ? 'Updates paused. Refresh before relying on this status.'
            : connected
              ? 'Live gate updates are connected.'
              : 'Connecting to live updates. Checking gate status in the background.'}
      </Copy>
      {query.isPending && <Loading label="Checking the gate…" />}
      <ErrorMessage message={query.error ? messageOf(query.error) : null} />
      {!query.isPending && !query.error && !query.data?.items.length && (
        <>
          <Label>
            {filter === 'WAITING'
              ? 'No visitors waiting'
              : filter === 'READY'
                ? 'No visitors ready to enter'
                : filter === 'INSIDE'
                  ? 'No visitors currently inside'
                  : 'No past visits yet'}
          </Label>
          <Copy>
            {view === 'RESIDENT'
              ? 'Requests for your flat will appear here.'
              : 'Register an arrival to request approval from the household.'}
          </Copy>
        </>
      )}
      {!query.error &&
        query.data?.items.map((r) => (
          <VisitorCard key={r.id} request={r}>
            <Button
              label={`View ${r.visitorName}`}
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/visitor',
                  params: { societyId, id: r.id, view },
                })
              }
            />
          </VisitorCard>
        ))}
      <Row>
        {pages.length > 1 && (
          <Button
            label="Previous page"
            variant="secondary"
            onPress={() => setPages((p) => p.slice(0, -1))}
          />
        )}
        {!query.error && !!query.data?.nextCursor && (
          <Button
            label="Next page"
            variant="secondary"
            onPress={() => setPages((p) => [...p, query.data!.nextCursor!])}
          />
        )}
      </Row>
      <RefreshButton
        label="Refresh visitors"
        variant="quiet"
        disabled={query.isFetching}
        onRefresh={() => query.refetch()}
      />
    </>
  );
}
