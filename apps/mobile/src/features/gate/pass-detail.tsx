import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  guestPassCommandSchema,
  guestPassDetailSchema,
  guestPassRevealSchema,
  gateSetupSchema,
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
import { gateKey, gatePath, useLiveGate } from './live';
import { PassCard } from './pass-card';
import { istLabel } from './pass-time';
type Intent = {
  kind: 'revoke' | 'exit';
  body: { intentId: string; expectedVersion: number; gateId?: string };
};
export function PassDetail({
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
  const live = useLiveGate(),
    client = useQueryClient(),
    [code, setCode] = useState(''),
    [codeError, setCodeError] = useState<string | null>(null),
    [revealing, setRevealing] = useState(false),
    epoch = useRef(0);
  const wipe = useCallback(() => {
    epoch.current++;
    setCode('');
  }, []);
  useFocusEffect(useCallback(() => () => wipe(), [wipe]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') wipe();
    });
    return () => sub.remove();
  }, [wipe]);
  const query = useQuery({
    queryKey: [...gateKey(userId, societyId), 'pass-detail', view, id],
    queryFn: async ({ signal }) => {
      try {
        const result = await api(
          gatePath(societyId, `passes/${id}?view=${view}`),
          guestPassDetailSchema,
          undefined,
          signal,
          userId,
        );
        if (
          result.pass.status !== 'READY' &&
          result.pass.status !== 'SCHEDULED'
        )
          wipe();
        return result;
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status))
          wipe();
        throw error;
      }
    },
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
        userId,
      ),
    enabled: live.enabled && view === 'GUARD',
    staleTime: 0,
  });
  const [gateId, setGate] = useState(''),
    [confirm, setConfirm] = useState<Intent['kind'] | null>(null),
    saved = useRef<Intent | null>(null),
    [retry, setRetry] = useState<Intent | null>(null);
  const action = useMutation({
    mutationFn: (intent: Intent) =>
      api(
        gatePath(societyId, `passes/${id}/${intent.kind}`),
        guestPassCommandSchema,
        intent.body,
        undefined,
        userId,
      ),
    onSuccess: async () => {
      saved.current = null;
      setRetry(null);
      setConfirm(null);
      wipe();
      await client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        saved.current = null;
        setRetry(null);
        setConfirm(null);
      }
      await query.refetch();
    },
  });
  const accessUnavailable =
    query.error instanceof ApiError &&
    [401, 403, 404].includes(query.error.status);
  const p = query.data?.pass,
    fresh =
      live.enabled &&
      !query.isFetching &&
      !query.error &&
      live.clock - query.dataUpdatedAt < 15000;
  const at =
    Date.parse(query.data?.serverNow ?? '') +
    Math.max(0, live.clock - query.dataUpdatedAt);
  const shareable =
    !!p &&
    (p.status === 'READY' || p.status === 'SCHEDULED') &&
    Date.parse(p.validUntil) > at;
  useEffect(() => () => wipe(), [shareable, wipe]);
  const gates = setup.data?.gates ?? [],
    selected = gateId || gates[0]?.id;
  async function reveal() {
    if (!fresh || !shareable || revealing) return;
    const generation = epoch.current;
    setRevealing(true);
    setCodeError(null);
    try {
      const result = await api(
        gatePath(societyId, `passes/${id}/code`),
        guestPassRevealSchema,
        {},
        undefined,
        userId,
      );
      if (generation === epoch.current && AppState.currentState === 'active')
        setCode(result.code);
    } catch (e) {
      setCodeError(messageOf(e));
    } finally {
      setRevealing(false);
    }
  }
  async function share() {
    if (!code || !p || !fresh || !shareable) return;
    try {
      await Share.share({
        message: `Guest pass for ${p.visitorName}\n${p.flat.tower} · ${p.flat.label}\n${istLabel(p.validFrom)} to ${istLabel(p.validUntil)}\nCode: ${code.match(/.{4}/g)!.join('-')}\nOne entry and one exit. Present this code to security at the gate.`,
      });
    } catch (e) {
      setCodeError(messageOf(e));
    }
  }
  function submit() {
    if (!p || !fresh || !confirm) return;
    const intent = saved.current ?? {
      kind: confirm,
      body: {
        intentId: randomUUID(),
        expectedVersion: p.version,
        ...(confirm === 'exit' ? { gateId: selected } : {}),
      },
    };
    saved.current = intent;
    setRetry(intent);
    action.mutate(intent);
  }
  if (query.isPending) return <Loading label="Checking guest pass…" />;
  if (accessUnavailable || !p)
    return (
      <>
        <ErrorMessage message={messageOf(query.error)} />
        <Button label="Retry pass" onPress={() => void query.refetch()} />
      </>
    );
  return (
    <>
      <PassCard pass={p} />
      <Copy small>
        {fresh
          ? 'Status refreshes every 5 seconds.'
          : 'Reconnect and refresh before taking action.'}
      </Copy>
      <ErrorMessage message={query.error ? messageOf(query.error) : null} />
      {view === 'RESIDENT' && shareable && (
        <Card>
          <Label>Share with your guest</Label>
          <Copy small>
            The code grants one entry during the visit window. Share it only
            with the invited guest.
          </Copy>
          {code && fresh ? (
            <>
              <Label>{code.match(/.{4}/g)!.join('-')}</Label>
              <Button label="Share guest pass" onPress={() => void share()} />
              <Button label="Hide code" variant="quiet" onPress={wipe} />
            </>
          ) : (
            <Button
              label="Show pass code"
              pending={revealing}
              disabled={!fresh}
              onPress={() => void reveal()}
            />
          )}
          <ErrorMessage message={codeError} />
        </Card>
      )}
      {view === 'RESIDENT' &&
        p.presence === 'NOT_ENTERED' &&
        p.status !== 'REVOKED' &&
        !confirm &&
        !retry && (
          <Button
            label="Revoke guest pass"
            variant="secondary"
            disabled={!fresh || action.isPending}
            onPress={() => setConfirm('revoke')}
          />
        )}
      {view === 'GUARD' && p.presence === 'INSIDE' && (
        <Card>
          <Label>Exit gate</Label>
          {gates.map((g) => (
            <Choice
              key={g.id}
              label={g.name}
              selected={selected === g.id}
              onPress={() => {
                if (!retry) setGate(g.id);
              }}
            />
          ))}
          <ErrorMessage message={setup.error ? messageOf(setup.error) : null} />
          {!confirm && !retry && (
            <Button
              label="Mark guest exit"
              disabled={
                !fresh || !selected || !!setup.error || action.isPending
              }
              onPress={() => setConfirm('exit')}
            />
          )}
        </Card>
      )}
      {(confirm || retry) && (
        <Card>
          <Label>
            {confirm === 'exit'
              ? 'Is this guest leaving now?'
              : 'Revoke this guest pass?'}
          </Label>
          <Copy>
            {confirm === 'exit'
              ? 'Confirm only after observing the guest at this gate.'
              : 'The code will stop working immediately. An entered visit cannot be revoked.'}
          </Copy>
          <Button
            label={
              retry && action.error ? 'Retry same action' : 'Confirm action'
            }
            pending={action.isPending}
            disabled={
              !fresh || (confirm === 'exit' && (!selected || !!setup.error))
            }
            onPress={submit}
          />
          {!retry && (
            <Button
              label="Keep reviewing"
              variant="quiet"
              onPress={() => setConfirm(null)}
            />
          )}
        </Card>
      )}
      <ErrorMessage message={action.error ? messageOf(action.error) : null} />
      <Button
        label="Refresh status"
        variant="secondary"
        pending={query.isFetching}
        onPress={() => void query.refetch()}
      />
      <Label>Movement history</Label>
      {!p.events.length && <Copy>No entry or exit has been recorded.</Copy>}
      {p.events.map((e) => (
        <Card key={e.id}>
          <Badge>{e.type === 'ENTRY' ? 'Entered' : 'Exited'}</Badge>
          <Copy>{e.gate.name}</Copy>
          <Copy small>{istLabel(e.at)}</Copy>
        </Card>
      ))}
    </>
  );
}
