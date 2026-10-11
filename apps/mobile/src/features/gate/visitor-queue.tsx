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
import { VisitorCard } from './visitor-card';
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
}: {
  userId: string;
  societyId: string;
  view: GateView;
}) {
  const live = useLiveGate();
  const [filter, setFilter] = useState<GateFilter>('WAITING');
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
      ),
    enabled: live.enabled,
    refetchInterval: 5000,
    staleTime: 0,
  });
  return (
    <>
      {view === 'GUARD' && (
        <Button
          label="Register visitor"
          onPress={() =>
            router.push({
              pathname: '/register-visitor',
              params: { societyId },
            })
          }
        />
      )}
      <Row>
        {(Object.keys(filters) as GateFilter[]).map((key) => (
          <Button
            key={key}
            label={filters[key]}
            variant={key === filter ? 'primary' : 'secondary'}
            onPress={() => {
              setFilter(key);
              setPages([undefined]);
            }}
          />
        ))}
      </Row>
      <Copy small>
        {!live.online
          ? 'You’re offline. Reconnect to get current gate status.'
          : query.error
            ? 'Updates paused. Refresh before relying on this status.'
            : 'Keep this screen open for new requests. Updates every 5 seconds; background alerts are coming soon.'}
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
      {query.data?.items.map((r) => (
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
        {!!query.data?.nextCursor && (
          <Button
            label="Next page"
            variant="secondary"
            onPress={() => setPages((p) => [...p, query.data!.nextCursor!])}
          />
        )}
      </Row>
      <Button
        label="Refresh visitors"
        variant="quiet"
        pending={query.isFetching}
        onPress={() => void query.refetch()}
      />
    </>
  );
}
