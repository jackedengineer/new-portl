import { useState } from 'react';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  arrivalInput,
  gateCommandSchema,
  gateSetupSchema,
  type ArrivalInput,
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
  Row,
} from '../../components/ui';
import { gateKey, gatePath, useLiveGate } from './live';
import { categoryLabel } from './visitor-card';
export function Registration({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const live = useLiveGate();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [flatId, setFlat] = useState('');
  const [gateId, setGate] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [category, setCategory] = useState<ArrivalInput['category']>('GUEST');
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<ArrivalInput | null>(null);
  const setup = useQuery({
    queryKey: [...gateKey(userId, societyId), 'register-setup', term],
    queryFn: ({ signal }) =>
      api(
        gatePath(
          societyId,
          `setup?view=GUARD&search=${encodeURIComponent(term)}`,
        ),
        gateSetupSchema,
        undefined,
        signal,
        userId,
      ),
    enabled: live.enabled,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
  const submit = useMutation({
    mutationFn: (input: ArrivalInput) =>
      api(
        gatePath(societyId, 'requests'),
        gateCommandSchema,
        input,
        undefined,
        userId,
      ),
    onSuccess: async (result) => {
      setIntent(null);
      await client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
      router.replace({
        pathname: '/visitor',
        params: { societyId, id: result.requestId, view: 'GUARD' },
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        setIntent(null);
    },
  });
  function register() {
    setError('');
    const parsed = arrivalInput.safeParse(
      intent ?? {
        intentId: randomUUID(),
        gateId: gateId || setup.data?.gates[0]?.id,
        flatId,
        visitorName: name,
        category,
        company,
      },
    );
    if (!parsed.success) {
      setError(
        'Enter the visitor’s name and select their gate and destination flat.',
      );
      return;
    }
    setIntent(parsed.data);
    submit.mutate(parsed.data);
  }
  const locked = submit.isPending || !!intent;
  return (
    <>
      <Copy>
        Send the household an arrival request. Admission is allowed only after
        resident approval.
      </Copy>
      {setup.isPending && <Loading label="Loading your assigned gates…" />}
      <ErrorMessage message={setup.error ? messageOf(setup.error) : null} />
      {setup.error && (
        <Button label="Retry gate setup" onPress={() => void setup.refetch()} />
      )}
      {!live.online && (
        <ErrorMessage message="You’re offline. Reconnect to register a visitor." />
      )}
      <Label>Arrival gate</Label>
      {setup.data?.gates.map((g) => (
        <Choice
          key={g.id}
          label={g.name}
          selected={(gateId || setup.data.gates[0]?.id) === g.id}
          onPress={() => {
            if (!locked) setGate(g.id);
          }}
        />
      ))}
      <Field
        label="Visitor name"
        value={name}
        onChangeText={setName}
        editable={!locked}
        maxLength={80}
        autoCapitalize="words"
      />
      <Label>Visitor type</Label>
      <Row>
        {(Object.keys(categoryLabel) as ArrivalInput['category'][]).map((c) => (
          <Choice
            key={c}
            label={categoryLabel[c]}
            selected={category === c}
            onPress={() => {
              if (!locked) setCategory(c);
            }}
          />
        ))}
      </Row>
      <Field
        label="Company or service (optional)"
        value={company}
        onChangeText={setCompany}
        editable={!locked}
        maxLength={80}
      />
      <Card>
        <Field
          label="Find tower or flat"
          placeholder="e.g. A or 101"
          value={search}
          editable={!locked}
          onChangeText={setSearch}
          maxLength={80}
        />
        <Button
          label="Search flats"
          variant="secondary"
          disabled={locked || !live.online}
          onPress={() => {
            setFlat('');
            setTerm(search.trim());
          }}
        />
        <Copy small>Up to 30 matches. Narrow the search to find a flat.</Copy>
        {setup.data?.flats.map((f) => (
          <Choice
            key={f.id}
            label={`${f.tower} · ${f.label}`}
            selected={flatId === f.id}
            onPress={() => {
              if (!locked) setFlat(f.id);
            }}
          />
        ))}
        {setup.data && !setup.data.flats.length && (
          <Copy>No matching active flats.</Copy>
        )}
      </Card>
      <ErrorMessage
        message={error || (submit.error ? messageOf(submit.error) : '')}
      />
      {intent && submit.error && (
        <Copy>
          We could not confirm whether the request was saved. Retry the same
          request to check safely.
        </Copy>
      )}
      <Button
        label={
          intent && submit.error
            ? 'Retry same request'
            : 'Send approval request'
        }
        pending={submit.isPending}
        disabled={!live.enabled || !!setup.error || setup.isPending}
        onPress={register}
      />
    </>
  );
}
