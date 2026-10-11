import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  guestPassListSchema,
  type GateView,
  type GuestPassFilter,
} from '@portl/contracts';
import { api, messageOf } from '../../lib/api';
import { Button, Copy, ErrorMessage, Loading, Row } from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
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
      ),
    enabled: live.enabled,
    refetchInterval: 5000,
    staleTime: 0,
  });
  return (
    <>
      {view === 'RESIDENT' && (
        <Button
          label="Create guest pass"
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
          onPress={() =>
            router.push({
              pathname: '/verify-guest-pass',
              params: { societyId },
            })
          }
        />
      )}
      <Row>
        {(['UPCOMING', 'INSIDE', 'HISTORY'] as const)
          .filter((f) => view !== 'GUARD' || f !== 'UPCOMING')
          .map((f) => (
            <Button
              key={f}
              label={
                f === 'UPCOMING'
                  ? 'Upcoming'
                  : f === 'INSIDE'
                    ? 'Inside'
                    : 'History'
              }
              variant={f === filter ? 'primary' : 'secondary'}
              onPress={() => {
                setFilter(f);
                setPages([undefined]);
              }}
            />
          ))}
      </Row>
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
      {query.data?.items.map((p) => (
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
        label="Refresh passes"
        variant="quiet"
        pending={query.isFetching}
        onPress={() => void query.refetch()}
      />
    </>
  );
}
