import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import {
  noticeCreateInput,
  noticeEditInput,
  noticeSchema,
  type Notice,
} from '@portl/contracts';
import {
  Button,
  Copy,
  ErrorMessage,
  Field,
  Loading,
} from '../../components/ui';
import { ApiError, messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { noticeKey, useNoticeRequest } from './request';
type Props = { userId: string; societyId: string; id?: string };
export function NoticeEditor(props: Props) {
  const request = useNoticeRequest(props.userId, props.societyId);
  const existing = useQuery({
    queryKey: [...noticeKey(props.userId, props.societyId), 'edit', props.id],
    queryFn: ({ signal }) =>
      request.call(`/${props.id}?view=ADMIN`, noticeSchema, undefined, signal),
    enabled: !!props.id,
    refetchOnWindowFocus: false,
  });
  if (props.id && existing.isPending)
    return <Loading label="Loading your draft…" />;
  const inaccessible =
    existing.error instanceof ApiError &&
    [401, 403, 404].includes(existing.error.status);
  if (props.id && existing.error && (!existing.data || inaccessible))
    return (
      <>
        <ErrorMessage message={messageOf(existing.error)} />
        <Button label="Retry draft" onPress={() => void existing.refetch()} />
      </>
    );
  if (existing.data && existing.data.status !== 'DRAFT')
    return (
      <Copy>
        This notice is no longer a draft. Return to the notice board to view it.
      </Copy>
    );
  return (
    <>
      {existing.error && (
        <>
          <ErrorMessage message={messageOf(existing.error)} />
          <Button label="Retry draft" onPress={() => void existing.refetch()} />
        </>
      )}
      <DraftForm
        key={`${props.userId}:${props.societyId}:${props.id ?? 'new'}`}
        {...props}
        initial={existing.data}
      />
    </>
  );
}
function DraftForm({
  userId,
  societyId,
  initial,
}: Props & { initial?: Notice }) {
  const [baseline] = useState(initial);
  const [id] = useState(() => baseline?.id ?? Crypto.randomUUID()),
    [title, setTitle] = useState(initial?.title ?? ''),
    [body, setBody] = useState(initial?.body ?? ''),
    [error, setError] = useState('');
  const request = useNoticeRequest(userId, societyId),
    client = useQueryClient(),
    { online } = useLiveGate();
  const save = useMutation({
    mutationFn: async () => {
      const input = baseline
        ? noticeEditInput.parse({
            title,
            body,
            expectedVersion: baseline.version,
          })
        : noticeCreateInput.parse({ id, title, body });
      return request.call(baseline ? `/${id}/edit` : '', noticeSchema, input);
    },
    onSuccess: (item) => {
      if (!request.active()) return;
      void client.invalidateQueries({ queryKey: noticeKey(userId, societyId) });
      router.replace({
        pathname: '/notice',
        params: { societyId, id: item.id, view: 'ADMIN' },
      });
    },
  });
  function submit() {
    const valid = noticeCreateInput.safeParse({ id, title, body });
    setError(
      valid.success
        ? ''
        : 'Enter a title up to 160 characters and details up to 10,000 characters.',
    );
    if (valid.success) save.mutate();
  }
  return (
    <>
      <Copy>
        Save a draft first. You’ll review it before sharing with every resident.
      </Copy>
      {baseline && initial && baseline.version !== initial.version && (
        <Copy>
          A newer draft is available. Your edits are kept; return to the notice
          to review it.
        </Copy>
      )}
      <Field
        label="Notice title"
        value={title}
        onChangeText={setTitle}
        maxLength={160}
        editable={!save.isPending}
        autoCapitalize="sentences"
      />
      <Field
        label="Notice details"
        value={body}
        onChangeText={setBody}
        maxLength={10000}
        editable={!save.isPending}
        multiline
        numberOfLines={8}
        textAlignVertical="top"
      />
      <Copy small>
        {body.length.toLocaleString()} / 10,000 characters · Plain text
      </Copy>
      <ErrorMessage
        message={error || (save.error ? messageOf(save.error) : '')}
      />
      {!online && <Copy>Reconnect before saving your draft.</Copy>}
      <Button
        label="Save draft"
        pending={save.isPending}
        disabled={!online}
        onPress={submit}
      />
      {baseline && save.error && (
        <Button
          label="Return to notice"
          variant="secondary"
          onPress={() =>
            router.replace({
              pathname: '/notice',
              params: { societyId, id, view: 'ADMIN' },
            })
          }
        />
      )}
    </>
  );
}
