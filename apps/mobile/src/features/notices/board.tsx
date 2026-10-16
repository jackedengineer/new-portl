import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { noticeListSchema, type NoticeView } from '@portl/contracts';
import {
  Badge,
  Button,
  Card,
  Copy,
  ErrorMessage,
  Label,
  Loading,
} from '../../components/ui';
import { Segments } from '../../components/task-ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { noticeKey, useNoticeRequest } from './request';
export function NoticeBoard({
  userId,
  societyId,
  view,
}: {
  userId: string;
  societyId: string;
  view: NoticeView;
}) {
  const [status, setStatus] = useState(''),
    request = useNoticeRequest(userId, societyId),
    { enabled } = useLiveGate();
  const list = useInfiniteQuery({
    queryKey: [...noticeKey(userId, societyId), 'list', view, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      request.call(
        `?view=${view}${status ? `&status=${status}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        noticeListSchema,
        undefined,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: enabled ? 15000 : false,
    refetchOnWindowFocus: 'always',
  });
  const items = list.error
    ? []
    : (list.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <>
      {view === 'ADMIN' && (
        <>
          <Button
            label="Create notice"
            icon="plus"
            onPress={() =>
              router.push({ pathname: '/notice-editor', params: { societyId } })
            }
          />
          <Segments
            label="Notice status"
            options={
              [
                ['', 'All'],
                ['DRAFT', 'Drafts'],
                ['PUBLISHED', 'Published'],
                ['ARCHIVED', 'Archived'],
              ] as const
            }
            value={status}
            onChange={setStatus}
          />
        </>
      )}
      {list.isPending && <Loading label="Loading society notices…" />}
      {list.error && <ErrorMessage message={messageOf(list.error)} />}
      {!list.isPending && !list.error && !items.length && (
        <Card>
          <Label>No notices here yet.</Label>
          <Copy>
            {view === 'ADMIN'
              ? 'Create a draft when you have an update to share.'
              : 'Updates from your society office will appear here.'}
          </Copy>
        </Card>
      )}
      {items.map((item) => (
        <Card key={item.id}>
          {view === 'ADMIN' && <Badge>{item.status}</Badge>}
          <Label>{item.title}</Label>
          <Copy small>
            {new Date(item.publishedAt ?? item.createdAt).toLocaleString()}
          </Copy>
          <Button
            label={view === 'ADMIN' ? 'Manage notice' : 'Read notice'}
            icon="arrow-right"
            variant="quiet"
            onPress={() =>
              router.push({
                pathname: '/notice',
                params: { id: item.id, societyId, view },
              })
            }
          />
        </Card>
      ))}
      {list.hasNextPage && (
        <Button
          label="Load older notices"
          variant="secondary"
          pending={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
        />
      )}
      <Button
        label={list.error ? 'Retry notices' : 'Refresh notices'}
        variant="quiet"
        pending={list.isRefetching}
        onPress={() => void list.refetch()}
      />
    </>
  );
}
