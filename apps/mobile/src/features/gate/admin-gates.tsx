import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  gateInput,
  gateSchema,
  gateSetupSchema,
  guardAssignmentInput,
  idSchema,
} from '@portl/contracts';
import { z } from 'zod';
import { api, messageOf } from '../../lib/api';
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
const saved = z.object({ id: idSchema });
export function AdminGates({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const live = useLiveGate(),
    client = useQueryClient();
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [gateId, setGate] = useState(''),
    [error, setError] = useState(''),
    [revoke, setRevoke] = useState<string | null>(null);
  const setup = useQuery({
    queryKey: [...gateKey(userId, societyId), 'setup', 'ADMIN'],
    queryFn: ({ signal }) =>
      api(
        gatePath(societyId, 'setup?view=ADMIN'),
        gateSetupSchema,
        undefined,
        signal,
        userId,
      ),
    enabled: live.enabled,
    staleTime: 0,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: gateKey(userId, societyId) });
  const create = useMutation({
    mutationFn: (input: z.infer<typeof gateInput>) =>
      api(
        gatePath(societyId, 'admin/gates'),
        gateSchema,
        input,
        undefined,
        userId,
      ),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const assign = useMutation({
    mutationFn: (input: z.infer<typeof guardAssignmentInput>) =>
      api(
        gatePath(societyId, 'admin/assignments'),
        saved,
        input,
        undefined,
        userId,
      ),
    onSuccess: async () => {
      setEmail('');
      await refresh();
      await client.invalidateQueries({ queryKey: ['identity'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(
        gatePath(societyId, `admin/assignments/${id}/revoke`),
        saved,
        {},
        undefined,
        userId,
      ),
    onSuccess: async () => {
      setRevoke(null);
      await refresh();
      await client.invalidateQueries({ queryKey: ['identity'] });
    },
  });
  const pending = create.isPending || assign.isPending || remove.isPending;
  const disabled = pending || !live.enabled;
  return (
    <>
      <Label>Gates & guard access</Label>
      <Copy>
        Guards sign in with email OTP first. Assign their verified account to a
        gate to enable guard operations.
      </Copy>
      {setup.isPending && <Loading label="Loading gate access…" />}
      <ErrorMessage message={setup.error ? messageOf(setup.error) : null} />
      <Card>
        <Field
          label="New gate name"
          placeholder="Main gate"
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        <Button
          label="Add gate"
          pending={create.isPending}
          disabled={disabled}
          onPress={() => {
            setError('');
            const p = gateInput.safeParse({ name });
            if (!p.success) {
              setError('Enter a gate name with at least 2 characters.');
              return;
            }
            create.mutate(p.data);
          }}
        />
      </Card>
      <Card>
        <Field
          label="Guard email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          maxLength={254}
        />
        {setup.data?.gates.map((g) => (
          <Choice
            key={g.id}
            label={g.name}
            selected={gateId === g.id}
            onPress={() => setGate(g.id)}
          />
        ))}
        {!setup.data?.gates.length && (
          <Copy>Add a gate before assigning a guard.</Copy>
        )}
        <Button
          label="Assign guard"
          pending={assign.isPending}
          disabled={disabled || !!setup.error}
          onPress={() => {
            setError('');
            const p = guardAssignmentInput.safeParse({ email, gateId });
            if (!p.success) {
              setError('Enter the guard’s email and select a gate.');
              return;
            }
            assign.mutate(p.data);
          }}
        />
      </Card>
      <Label>Active assignments</Label>
      <Copy small>
        Showing up to 100 active assignments and gates. Larger societies need
        the later directory administration slice.
      </Copy>
      {setup.data && !setup.data.assignments.length && (
        <Copy>No guards assigned yet.</Copy>
      )}
      {setup.data?.assignments.map((a) => (
        <Card key={a.id}>
          <Label>{a.name || 'Guard'}</Label>
          <Copy>
            {a.email} · {a.gate.name}
          </Copy>
          {revoke === a.id ? (
            <>
              <Copy>
                Remove this gate assignment? If it is their last assignment,
                guard access to this society will end.
              </Copy>
              <Button
                label="Confirm removal"
                pending={remove.isPending}
                disabled={disabled}
                onPress={() => remove.mutate(a.id)}
              />
              <Button
                label="Keep assignment"
                variant="quiet"
                onPress={() => setRevoke(null)}
              />
            </>
          ) : (
            <Button
              label={`Remove ${a.email} from ${a.gate.name}`}
              variant="secondary"
              disabled={disabled}
              onPress={() => setRevoke(a.id)}
            />
          )}
        </Card>
      ))}
      <ErrorMessage
        message={
          error || messageOfError(create.error || assign.error || remove.error)
        }
      />
      <Button
        label="Refresh gate access"
        variant="quiet"
        pending={setup.isFetching}
        onPress={() => void setup.refetch()}
      />
    </>
  );
}
const messageOfError = (e: unknown) => (e ? messageOf(e) : '');
