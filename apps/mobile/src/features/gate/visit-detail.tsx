import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  gateCommandSchema,
  gateSetupSchema,
  visitorDetailSchema,
  type GateView,
} from '@portl/contracts';
import { api, ApiError, messageOf } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  Choice,
  Copy,
  ErrorMessage,
  Label,
  Loading,
} from '../../components/ui';
import { VisitorCard } from './visitor-card';
import { gateKey, gatePath, useLiveGate } from './live';
type Action = 'APPROVE' | 'REJECT' | 'cancel' | 'entry' | 'exit';
type Intent = {
  kind: string;
  body: {
    intentId: string;
    expectedVersion: number;
    gateId?: string;
    decision?: 'APPROVE' | 'REJECT';
  };
};
export function VisitDetail({
  userId,
  societyId,
  id,
  view,
}: {
  userId: string;
  societyId: string;
  id: string;
  view: GateView;
}) {
  const live = useLiveGate();
  const client = useQueryClient();
  const [choice, setChoice] = useState<Action | null>(null);
  const [gateId, setGate] = useState('');
  const retryRef = useRef<Intent | null>(null);
  const [retry, setRetry] = useState<Intent | null>(null);
  const query = useQuery({
    queryKey: [...gateKey(userId, societyId), 'detail', view, id],
    queryFn: ({ signal }) =>
      api(
        gatePath(societyId, `requests/${id}?view=${view}`),
        visitorDetailSchema,
        undefined,
        signal,
      ),
    enabled: live.enabled,
    refetchInterval: 5000,
    staleTime: 0,
  });
  const setup = useQuery({
    queryKey: [...gateKey(userId, societyId), 'setup', view],
    queryFn: ({ signal }) =>
      api(
        gatePath(societyId, `setup?view=${view}`),
        gateSetupSchema,
        undefined,
        signal,
      ),
    enabled: live.enabled && view === 'GUARD',
    staleTime: 0,
  });
  const action = useMutation({
    mutationFn: (intent: Intent) =>
      api(
        gatePath(societyId, `requests/${id}/${intent.kind}`),
        gateCommandSchema,
        intent.body,
      ),
    onSuccess: async () => {
      retryRef.current = null;
      setRetry(null);
      setChoice(null);
      await client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        retryRef.current = null;
        setRetry(null);
        setChoice(null);
      }
      await query.refetch();
    },
  });
  if (query.isPending) return <Loading label="Checking visitor status…" />;
  const r = query.data?.request;
  if (!r)
    return (
      <>
        <ErrorMessage message={messageOf(query.error)} />
        <Button label="Retry visitor" onPress={() => void query.refetch()} />
      </>
    );
  const fresh =
    live.enabled &&
    !query.isFetching &&
    !query.error &&
    live.clock - query.dataUpdatedAt < 15000;
  const at =
    Date.parse(query.data!.serverNow) +
    Math.max(0, live.clock - query.dataUpdatedAt);
  const waiting = r.status === 'PENDING' && Date.parse(r.expiresAt) > at;
  const ready =
    r.status === 'APPROVED' &&
    r.presence === 'NOT_ENTERED' &&
    !!r.approvedUntil &&
    Date.parse(r.approvedUntil) > at;
  const gates = setup.data?.gates ?? [];
  const selectedGate = gateId || gates[0]?.id;
  const disabled = !fresh || action.isPending;
  function confirm() {
    if (!choice || !fresh) return;
    const decision = choice === 'APPROVE' || choice === 'REJECT';
    const intent = retryRef.current ?? {
      kind: decision ? 'decision' : choice,
      body: {
        intentId: randomUUID(),
        expectedVersion: r!.version,
        ...(decision
          ? { decision: choice as 'APPROVE' | 'REJECT' }
          : choice === 'entry' || choice === 'exit'
            ? { gateId: selectedGate }
            : {}),
      },
    };
    retryRef.current = intent;
    setRetry(intent);
    action.mutate(intent);
  }
  return (
    <>
      <VisitorCard request={r} />
      <Copy small>
        {fresh
          ? 'Status refreshes every 5 seconds while this screen is open.'
          : 'Status is not current. Reconnect and refresh before taking action.'}
      </Copy>
      <ErrorMessage message={query.error ? messageOf(query.error) : null} />
      <ErrorMessage message={action.error ? messageOf(action.error) : null} />
      {!choice && !retry && view === 'RESIDENT' && waiting && (
        <>
          <Button
            label="Approve visitor"
            disabled={disabled}
            onPress={() => setChoice('APPROVE')}
          />
          <Button
            label="Reject visitor"
            variant="secondary"
            disabled={disabled}
            onPress={() => setChoice('REJECT')}
          />
          <Copy small>
            Any current resident of your flat can respond. The first decision is
            final.
          </Copy>
        </>
      )}
      {view === 'GUARD' && (ready || r.presence === 'INSIDE') && (
        <Card>
          <Label>Record at gate</Label>
          {gates.map((g) => (
            <Choice
              key={g.id}
              label={g.name}
              selected={selectedGate === g.id}
              onPress={() => {
                if (!retry) setGate(g.id);
              }}
            />
          ))}
          <ErrorMessage message={setup.error ? messageOf(setup.error) : null} />
          {!choice && !retry && (
            <Button
              label={ready ? 'Mark entry' : 'Mark exit'}
              disabled={disabled || !selectedGate || !!setup.error}
              onPress={() => setChoice(ready ? 'entry' : 'exit')}
            />
          )}
        </Card>
      )}
      {view === 'GUARD' && waiting && !choice && !retry && (
        <>
          <Copy>
            Wait for a resident’s decision before admitting this visitor.
          </Copy>
          <Button
            label="Cancel request"
            variant="secondary"
            disabled={disabled}
            onPress={() => setChoice('cancel')}
          />
        </>
      )}
      {(choice || retry) && (
        <Card>
          <Label>
            {retry && action.error
              ? 'Confirming your previous action'
              : choice === 'APPROVE'
                ? 'Allow this visitor to enter?'
                : choice === 'REJECT'
                  ? 'Reject this visitor?'
                  : choice === 'entry'
                    ? 'Is this visitor entering now?'
                    : choice === 'exit'
                      ? 'Is this visitor leaving now?'
                      : 'Cancel this waiting request?'}
          </Label>
          <Copy>
            {r.visitorName} · {r.flat.tower} {r.flat.label}
          </Copy>
          <Copy small>
            {choice === 'APPROVE'
              ? 'The guard must verify the visitor and record entry within 30 minutes.'
              : choice === 'entry' || choice === 'exit'
                ? 'Only confirm after observing the visitor at the selected gate.'
                : 'This action will be visible to the guard and the household.'}
          </Copy>
          <Button
            label={
              action.error && retry ? 'Retry same action' : 'Confirm action'
            }
            pending={action.isPending}
            disabled={
              disabled ||
              ((choice === 'entry' || choice === 'exit') && !selectedGate)
            }
            onPress={confirm}
          />
          {!retry && (
            <Button
              label="Keep reviewing"
              variant="quiet"
              onPress={() => setChoice(null)}
            />
          )}
        </Card>
      )}
      <Button
        label="Refresh status"
        variant="secondary"
        pending={query.isFetching}
        onPress={() => void query.refetch()}
      />
      <Label>Movement history</Label>
      {!r.events.length && <Copy>No entry or exit has been recorded.</Copy>}
      {r.events.map((e) => (
        <Card key={e.id}>
          <Badge>{e.type === 'ENTRY' ? 'Entered' : 'Exited'}</Badge>
          <Copy>{e.gate.name}</Copy>
          <Copy small>{new Date(e.at).toLocaleString('en-IN')}</Copy>
        </Card>
      ))}
    </>
  );
}
