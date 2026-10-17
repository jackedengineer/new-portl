import { useEffect, useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  notificationCopy,
  notificationListSchema,
  notificationSchema,
} from '@portl/contracts';
import {
  Badge,
  Button,
  Card,
  Copy,
  ErrorMessage,
  Label,
  Loading,
} from '../../components/ui';
import { Identity } from '../../components/identity';
import { api, messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { notificationDestination } from './navigation';
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushAvailable,
} from './native';
export function NotificationInbox({ userId }: { userId: string }) {
  const opening = useMemo(
    () => ({ userId, controller: new AbortController() }),
    [userId],
  );
  useEffect(() => () => opening.controller.abort(), [opening]);
  const client = useQueryClient(),
    { enabled: live } = useLiveGate();
  const [enabled, setEnabled] = useState(false),
    [pushError, setPushError] = useState('');
  useEffect(() => {
    let active = true;
    void isPushEnabled(userId)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  const inbox = useInfiniteQuery({
    queryKey: ['notifications', userId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        notificationListSchema,
        undefined,
        signal,
        userId,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: live ? 30_000 : false,
    refetchOnWindowFocus: 'always',
  });
  const open = useMutation({
    mutationFn: (id: string) =>
      notificationDestination({ notificationId: id }, (nid) =>
        api(
          `/notifications/${nid}/read`,
          notificationSchema,
          {},
          opening.controller.signal,
          opening.userId,
        ),
      ),
    onSuccess: (destination) => {
      if (opening.controller.signal.aborted) return;
      void client.invalidateQueries({ queryKey: ['notifications', userId] });
      if (destination) router.push(destination);
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });
  const push = useMutation({
    mutationFn: async () => {
      setPushError('');
      if (enabled) await disablePush(userId);
      else await enablePush(userId);
      setEnabled(!enabled);
    },
    onError: (e) => setPushError(messageOf(e)),
  });
  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <Card>
        <Label>Stay close to your community</Label>
        <Copy>
          Your private inbox keeps gate updates and society notices together.
          Push alerts show a generic message on your lock screen.
        </Copy>
        {pushAvailable() ? (
          <Button
            label={
              enabled
                ? 'Turn off push on this device'
                : 'Enable push on this device'
            }
            variant="secondary"
            pending={push.isPending}
            disabled={push.isPending}
            onPress={() => push.mutate()}
          />
        ) : (
          <Copy>
            Push alerts need an installed Portl build. Your inbox works in Expo
            Go.
          </Copy>
        )}
        <ErrorMessage message={pushError} />
      </Card>
      <Label>
        {inbox.data
          ? `${inbox.data.pages[0]?.unread ?? 0} unread`
          : 'Your notifications'}
      </Label>
      {inbox.isPending && <Loading label="Loading your notifications…" />}
      {inbox.error && (
        <>
          <ErrorMessage message={messageOf(inbox.error)} />
          <Button
            label="Retry notifications"
            variant="secondary"
            onPress={() => void inbox.refetch()}
          />
        </>
      )}
      {!inbox.isPending && !inbox.error && !items.length && (
        <Copy>
          All quiet for now. Visitor requests, gate updates and society notices
          will appear here.
        </Copy>
      )}
      {items.map((item) => (
        <Card key={item.id}>
          <Badge>{item.readAt ? 'Read' : 'Unread'}</Badge>
          <Identity title={notificationCopy[item.type].title} icon="bell" />
          <Copy>{notificationCopy[item.type].body}</Copy>
          <Copy small>{new Date(item.createdAt).toLocaleString()}</Copy>
          <Button
            label="Open notification"
            icon="arrow-right"
            variant="secondary"
            disabled={open.isPending}
            pending={open.isPending && open.variables === item.id}
            onPress={() => open.mutate(item.id)}
          />
        </Card>
      ))}
      <ErrorMessage message={open.error ? messageOf(open.error) : ''} />
      {inbox.hasNextPage && (
        <Button
          label="Load older notifications"
          variant="secondary"
          pending={inbox.isFetchingNextPage}
          onPress={() => void inbox.fetchNextPage()}
        />
      )}
      <Button
        label="Refresh inbox"
        variant="quiet"
        onPress={() => void inbox.refetch()}
      />
    </>
  );
}
