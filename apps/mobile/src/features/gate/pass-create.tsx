import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  guestPassCreateInput,
  guestPassCommandSchema,
  guestPassSetupSchema,
  type GuestPassCreate,
} from '@portl/contracts';
import { api, ApiError, messageOf } from '../../lib/api';
import {
  Button,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Loading,
  Row,
} from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
import { istFields, istWindow } from './pass-time';
export function PassCreate({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const live = useLiveGate(),
    client = useQueryClient();
  const [name, setName] = useState(''),
    [flatId, setFlat] = useState(''),
    [start, setStart] = useState(() => istFields(Date.now())),
    [minutes, setMinutes] = useState(240),
    [error, setError] = useState<string | null>(null);
  const saved = useRef<GuestPassCreate | null>(null),
    [retry, setRetry] = useState(false);
  const setup = useQuery({
    queryKey: [...gateKey(userId, societyId), 'pass-setup'],
    queryFn: ({ signal }) =>
      api(
        gatePath(societyId, 'passes/setup'),
        guestPassSetupSchema,
        undefined,
        signal,
        userId,
      ),
    enabled: live.enabled,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: (body: GuestPassCreate) =>
      api(
        gatePath(societyId, 'passes'),
        guestPassCommandSchema,
        body,
        undefined,
        userId,
      ),
    onSuccess: async (result) => {
      saved.current = null;
      setRetry(false);
      await client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
      router.replace({
        pathname: '/guest-pass',
        params: { societyId, id: result.passId, view: 'RESIDENT' },
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        saved.current = null;
        setRetry(false);
      }
    },
  });
  const flats = setup.data?.flats ?? [],
    selected = flatId || flats[0]?.id,
    locked = retry || mutation.isPending;
  function submit() {
    if (!live.enabled) return;
    if (saved.current) {
      mutation.mutate(saved.current);
      return;
    }
    const window = istWindow(start.date, start.time, minutes);
    const parsed = guestPassCreateInput.safeParse({
      intentId: randomUUID(),
      flatId: selected,
      visitorName: name,
      ...window,
    });
    if (!parsed.success) {
      setError('Enter the guest name, a valid date and time, and your flat.');
      return;
    }
    setError(null);
    saved.current = parsed.data;
    setRetry(true);
    mutation.mutate(parsed.data);
  }
  if (setup.isPending) return <Loading label="Finding your flats…" />;
  return (
    <>
      <Copy>
        Invite someone before they arrive. Share their pass code and ask them to
        present it at the gate.
      </Copy>
      <Label>Your flat</Label>
      {flats.map((f) => (
        <Choice
          key={f.id}
          label={`${f.tower} · ${f.label}`}
          selected={selected === f.id}
          onPress={() => {
            if (!locked) setFlat(f.id);
          }}
        />
      ))}
      {!flats.length && !setup.error && (
        <Copy>
          You need a current occupancy in an active flat to create a pass.
        </Copy>
      )}
      <Field
        label="Guest name"
        value={name}
        onChangeText={setName}
        maxLength={80}
        editable={!locked}
      />
      <Field
        label="Visit date (YYYY-MM-DD, IST)"
        value={start.date}
        onChangeText={(date) => setStart((p) => ({ ...p, date }))}
        editable={!locked}
        autoCapitalize="none"
      />
      <Field
        label="Start time (HH:mm, IST)"
        value={start.time}
        onChangeText={(time) => setStart((p) => ({ ...p, time }))}
        editable={!locked}
        autoCapitalize="none"
      />
      <Button
        label="Start now"
        variant="quiet"
        disabled={locked}
        onPress={() => setStart(istFields(Date.now()))}
      />
      <Label>Valid for</Label>
      <Row>
        {[15, 60, 240, 480, 1440].map((m) => (
          <Button
            key={m}
            label={m < 60 ? '15 min' : `${m / 60} hr`}
            variant={minutes === m ? 'primary' : 'secondary'}
            disabled={locked}
            onPress={() => setMinutes(m)}
          />
        ))}
      </Row>
      <Copy small>
        Schedule up to 7 days ahead. Each pass allows one entry and one exit.
        You can revoke it before entry.
      </Copy>
      <ErrorMessage
        message={
          error ||
          (setup.error ? messageOf(setup.error) : null) ||
          (mutation.error ? messageOf(mutation.error) : null)
        }
      />
      {retry && mutation.error && (
        <Copy>
          We couldn’t confirm the result. Retry with the same details to avoid
          creating a duplicate.
        </Copy>
      )}
      <Button
        label={
          retry && mutation.error ? 'Retry creating pass' : 'Create guest pass'
        }
        pending={mutation.isPending}
        disabled={!live.enabled || !!setup.error || !selected}
        onPress={submit}
      />
      {setup.error && (
        <Button label="Retry flats" onPress={() => void setup.refetch()} />
      )}
    </>
  );
}
