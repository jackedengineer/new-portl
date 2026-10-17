import { RefreshButton } from '../../components/refresh-button';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { noticeSchema, type NoticeView } from '@portl/contracts';
import {
  Badge,
  Button,
  Card,
  Copy,
  ErrorMessage,
  Label,
  Loading,
  Title,
} from '../../components/ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { noticeKey, useNoticeRequest } from './request';
export function NoticeDetail({
  userId,
  societyId,
  id,
  view,
}: {
  userId: string;
  societyId: string;
  id: string;
  view: NoticeView;
}) {
  const request = useNoticeRequest(userId, societyId),
    client = useQueryClient(),
    { enabled, online } = useLiveGate();
  const [confirm, setConfirm] = useState<{
    action: 'publish' | 'archive';
    version: number;
  } | null>(null);
  const detail = useQuery({
    queryKey: [...noticeKey(userId, societyId), 'detail', id, view],
    queryFn: ({ signal }) =>
      request.call(`/${id}?view=${view}`, noticeSchema, undefined, signal),
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: 'always',
  });
  const command = useMutation({
    mutationFn: ({
      action,
      version,
    }: {
      action: 'publish' | 'archive';
      version: number;
    }) =>
      request.call(`/${id}/${action}`, noticeSchema, {
        expectedVersion: version,
      }),
    onSuccess: () => {
      if (!request.active()) return;
      setConfirm(null);
      void client.invalidateQueries({ queryKey: noticeKey(userId, societyId) });
      void client.invalidateQueries({ queryKey: ['notifications', userId] });
    },
    onError: () => {
      if (request.active())
        void client.invalidateQueries({
          queryKey: noticeKey(userId, societyId),
        });
    },
  });
  if (detail.isPending) return <Loading label="Loading notice…" />;
  if (detail.error || !detail.data)
    return (
      <>
        <ErrorMessage
          message={
            detail.error
              ? messageOf(detail.error)
              : 'Notice no longer available'
          }
        />
        <Button
          label="Retry notice"
          variant="secondary"
          onPress={() => void detail.refetch()}
        />
      </>
    );
  const item = detail.data;
  return (
    <>
      <Badge>{item.status}</Badge>
      <Title>{item.title}</Title>
      <Copy small>
        {item.publishedAt
          ? `Published ${new Date(item.publishedAt).toLocaleString()}`
          : `Draft created ${new Date(item.createdAt).toLocaleString()}`}
      </Copy>
      <Copy>{item.body}</Copy>
      {item.archivedAt && (
        <Copy small>Archived {new Date(item.archivedAt).toLocaleString()}</Copy>
      )}
      {view === 'ADMIN' && item.status !== 'ARCHIVED' && (
        <>
          {item.status === 'DRAFT' && (
            <>
              <Button
                label="Edit draft"
                variant="secondary"
                disabled={command.isPending || !online}
                onPress={() =>
                  router.push({
                    pathname: '/notice-editor',
                    params: { societyId, id },
                  })
                }
              />
              <Button
                label="Publish notice"
                disabled={command.isPending || !online}
                onPress={() => {
                  command.reset();
                  setConfirm({ action: 'publish', version: item.version });
                }}
              />
            </>
          )}
          <Button
            label="Archive notice"
            variant="secondary"
            disabled={command.isPending || !online}
            onPress={() => {
              command.reset();
              setConfirm({ action: 'archive', version: item.version });
            }}
          />
        </>
      )}
      {confirm && (
        <Card>
          <Label>
            {confirm.action === 'publish'
              ? 'Publish for your society?'
              : 'Archive this notice?'}
          </Label>
          <Copy>
            {confirm.action === 'publish'
              ? 'Every current resident will receive an inbox update. Published content cannot be edited.'
              : 'Residents will no longer see this notice. Archiving is permanent.'}
          </Copy>
          <Button
            label={
              confirm.action === 'publish'
                ? 'Confirm publish'
                : 'Confirm archive'
            }
            pending={command.isPending}
            disabled={!online}
            onPress={() => command.mutate(confirm)}
          />
          <Button
            label="Keep reviewing"
            variant="quiet"
            disabled={command.isPending}
            onPress={() => setConfirm(null)}
          />
        </Card>
      )}
      {!online && <Copy>Reconnect before changing this notice.</Copy>}
      <ErrorMessage message={command.error ? messageOf(command.error) : ''} />
      <RefreshButton
        label="Refresh notice"
        variant="quiet"
        disabled={detail.isFetching}
        onRefresh={() => {
          setConfirm(null);
          return detail.refetch();
        }}
      />
    </>
  );
}
