import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  guestPassCode,
  guestPassDetailSchema,
  guestPassCommandSchema,
  gateSetupSchema,
  type GuestPassEntry,
} from '@portl/contracts';
import { api, ApiError, messageOf } from '../../lib/api';
import {
  Button,
  Card,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Loading,
} from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
import { PassCard } from './pass-card';
type Verified = {
  data: ReturnType<typeof guestPassDetailSchema.parse>;
  receivedAt: number;
  code: string;
  gateId: string;
};
export function PassVerify({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const live = useLiveGate(),
    client = useQueryClient(),
    [code, setCode] = useState(''),
    [gateId, setGate] = useState(''),
    [verified, setVerified] = useState<Verified | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(false),
    [confirm, setConfirm] = useState(false),
    saved = useRef<{ id: string; body: GuestPassEntry } | null>(null),
    epoch = useRef(0);
  const wipe = useCallback(() => {
    epoch.current++;
    setCode('');
    setVerified(null);
    saved.current = null;
    setRetry(false);
    setConfirm(false);
  }, []);
  useFocusEffect(useCallback(() => () => wipe(), [wipe]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') wipe();
    });
    return () => sub.remove();
  }, [wipe]);
  const setup = useQuery({
    queryKey: [...gateKey(userId, societyId), 'setup', 'GUARD'],
    queryFn: ({ signal }) =>
      api(
        gatePath(societyId, 'setup?view=GUARD'),
        gateSetupSchema,
        undefined,
        signal,
      ),
    enabled: live.enabled,
    staleTime: 0,
  });
  const gates = setup.data?.gates ?? [],
    selected = gateId || gates[0]?.id;
  async function verify() {
    const parsed = guestPassCode.safeParse(code);
    if (!parsed.success) {
      setError('Enter the 16-character code shown on the guest pass.');
      return;
    }
    if (!selected || !live.enabled || pending || retry) return;
    const generation = epoch.current;
    setError(null);
    setPending(true);
    setVerified(null);
    setConfirm(false);
    try {
      const data = await api(
        gatePath(societyId, 'passes/verify'),
        guestPassDetailSchema,
        { code: parsed.data, gateId: selected },
      );
      if (epoch.current === generation && AppState.currentState === 'active')
        setVerified({
          data,
          receivedAt: Date.now(),
          code: parsed.data,
          gateId: selected,
        });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  async function enter() {
    if (!live.enabled || pending || (!saved.current && !verified)) return;
    const intent = saved.current ?? {
      id: verified!.data.pass.id,
      body: {
        intentId: randomUUID(),
        expectedVersion: verified!.data.pass.version,
        gateId: verified!.gateId,
        code: verified!.code,
      },
    };
    saved.current = intent;
    setRetry(true);
    setPending(true);
    setError(null);
    const generation = epoch.current;
    try {
      await api(
        gatePath(societyId, `passes/${intent.id}/entry`),
        guestPassCommandSchema,
        intent.body,
      );
      await client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
      if (generation === epoch.current) {
        wipe();
        router.replace({
          pathname: '/guest-pass',
          params: { societyId, id: intent.id, view: 'GUARD' },
        });
      }
    } catch (e) {
      if (generation === epoch.current) {
        setError(messageOf(e));
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          saved.current = null;
          setRetry(false);
          setConfirm(false);
          setVerified(null);
        }
      }
    } finally {
      setPending(false);
    }
  }
  const at = verified
    ? Date.parse(verified.data.serverNow) +
      Math.max(0, live.clock - verified.receivedAt)
    : 0;
  const fresh =
    !!verified && live.enabled && live.clock - verified.receivedAt < 15000;
  const ready =
    fresh &&
    verified.data.pass.status === 'READY' &&
    Date.parse(verified.data.pass.validFrom) <= at &&
    Date.parse(verified.data.pass.validUntil) > at;
  if (setup.isPending) return <Loading label="Finding your gates…" />;
  return (
    <>
      <Copy>
        Ask the guest to present their pass code. Verify it, then confirm their
        name and destination before recording entry.
      </Copy>
      <Label>Entry gate</Label>
      {gates.map((g) => (
        <Choice
          key={g.id}
          label={g.name}
          selected={selected === g.id}
          onPress={() => {
            if (!pending && !retry) {
              setGate(g.id);
              setVerified(null);
              setConfirm(false);
            }
          }}
        />
      ))}
      <Field
        label="Guest pass code"
        value={code}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={32}
        editable={!pending && !retry}
        onChangeText={(value) => {
          setCode(value);
          setVerified(null);
          setConfirm(false);
        }}
      />
      <ErrorMessage message={setup.error ? messageOf(setup.error) : null} />
      {!retry && (
        <Button
          label={verified ? 'Refresh verification' : 'Verify code'}
          pending={pending}
          disabled={!live.enabled || !selected || !!setup.error}
          onPress={() => void verify()}
        />
      )}
      <ErrorMessage message={error} />
      {verified && (
        <PassCard pass={verified.data.pass}>
          <Copy small>
            {fresh
              ? 'Verification does not record entry.'
              : 'Verification is stale. Refresh it before entry.'}
          </Copy>
          {!ready && <Copy>This pass cannot currently authorize entry.</Copy>}
          {ready && !confirm && !retry && (
            <Button
              label="Record guest entry"
              disabled={pending}
              onPress={() => setConfirm(true)}
            />
          )}
        </PassCard>
      )}
      {(confirm || retry) && (
        <Card>
          <Label>
            {retry && error
              ? 'Confirming your previous entry'
              : 'Is this guest entering now?'}
          </Label>
          <Copy>
            Confirm the guest’s name and destination, and observe entry at the
            selected gate.
          </Copy>
          {retry && error && (
            <Copy>
              Retry the same entry to safely confirm its result. If you leave
              this screen, check Inside and History before attempting another
              entry.
            </Copy>
          )}
          <Button
            label={retry && error ? 'Retry same entry' : 'Confirm guest entry'}
            pending={pending}
            disabled={!live.enabled || (!retry && !ready) || !!setup.error}
            onPress={() => void enter()}
          />
          {!retry && (
            <Button
              label="Keep reviewing"
              variant="quiet"
              onPress={() => setConfirm(false)}
            />
          )}
        </Card>
      )}
      <Button
        label="Guest entry and exit history"
        variant="quiet"
        onPress={() =>
          router.push({
            pathname: '/guest-passes',
            params: { societyId, view: 'GUARD' },
          })
        }
      />
    </>
  );
}
