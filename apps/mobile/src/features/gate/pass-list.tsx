import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  guestPassListSchema,
  type GateView,
  type GuestPassFilter,
} from '@portl/contracts';
import { api, ApiError, messageOf } from '../../lib/api';
import { Button, Copy, ErrorMessage, Loading, Row } from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
import { Segments } from '../../components/task-ui';
import { PassCard } from './pass-card';
export function PassList({
  userId,
  societyId,
  view,
}: {
  userId: string;
  societyId: string;
  view: GateView;
}) {
  const live = useLiveGate(),
    [filter, setFilter] = useState<GuestPassFilter>(
      view === 'GUARD' ? 'INSIDE' : 'UPCOMING',
    ),
    [pages, setPages] = useState<(string | undefined)[]>([undefined]),
    cursor = pages.at(-1);
  const query = useQuery({
    queryKey: [...gateKey(userId, societyId), 'passes', view, filter, cursor],
    queryFn: ({ signal }) =>
      api(
        gatePath(
          societyId,
          `passes?view=${view}&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        ),
        guestPassListSchema,
        undefined,
        signal,
        userId,
      ),
    enabled: live.enabled,
    refetchInterval: 5000,
    staleTime: 0,
  });
  const accessUnavailable =
    query.error instanceof ApiError &&
    [401, 403, 404].includes(query.error.status);
  return (
    <>
      {view === 'RESIDENT' && (
        <Button
          label="Create guest pass"
          disabled={!live.enabled || !!query.error}
          onPress={() =>
            router.push({
              pathname: '/create-guest-pass',
              params: { societyId },
            })
          }
        />
      )}
      {view === 'GUARD' && (
        <Button
          label="Verify guest pass"
          disabled={!live.enabled || !!query.error}
          onPress={() =>
            router.push({
              pathname: '/verify-guest-pass',
              params: { societyId },
            })
          }
        />
      )}
      <Segments
        label="Guest pass status"
        options={(['UPCOMING', 'INSIDE', 'HISTORY'] as const)
          .filter((f) => view !== 'GUARD' || f !== 'UPCOMING')
          .map(
            (f) =>
              [
                f,
                f === 'UPCOMING'
                  ? 'Upcoming'
                  : f === 'INSIDE'
                    ? 'Inside'
                    : 'History',
              ] as const,
          )}
        value={filter}
        disabled={accessUnavailable}
        onChange={(f) => {
          setFilter(f);
          setPages([undefined]);
        }}
      />
      <Copy small>
        {!live.online
          ? 'You’re offline. Reconnect for current pass status.'
          : 'Passes refresh every 5 seconds while this screen is open.'}
      </Copy>
      {query.isPending && <Loading label="Checking guest passes…" />}
      <ErrorMessage message={query.error ? messageOf(query.error) : null} />
      {!query.isPending && !query.error && !query.data?.items.length && (
        <Copy>No {filter.toLowerCase()} guest passes yet.</Copy>
      )}
      {!accessUnavailable &&
        query.data?.items.map((p) => (
          <PassCard key={p.id} pass={p}>
            <Button
              label={`View ${p.visitorName}`}
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/guest-pass',
                  params: { societyId, id: p.id, view },
                })
              }
            />
          </PassCard>
        ))}
      <Row>
        {pages.length > 1 && (
          <Button
            label="Previous page"
            variant="secondary"
            disabled={accessUnavailable}
            onPress={() => setPages((p) => p.slice(0, -1))}
          />
        )}
        {!accessUnavailable && !!query.data?.nextCursor && (
          <Button
            label="Next page"
            variant="secondary"
            onPress={() => setPages((p) => [...p, query.data!.nextCursor!])}
          />
        )}
      </Row>
      <Button
        label="Refresh passes"
        variant="quiet"
        pending={query.isFetching}
        onPress={() => void query.refetch()}
      />
    </>
  );
}
