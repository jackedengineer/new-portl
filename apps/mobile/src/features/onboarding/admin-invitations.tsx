import { useState } from 'react';
import { Share, Text } from 'react-native';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  flatSchema,
  invitationCreatedSchema,
  invitationInput,
  invitationListSchema,
} from '@portl/contracts';
import { z } from 'zod';
import { api, messageOf, successSchema } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  Choice,
  colors,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Loading,
  Row,
} from '../../components/ui';
import { FlatPicker } from './flat-picker';

export function AdminInvitations({
  userId,
  societyId,
  societyName,
}: {
  userId: string;
  societyId: string;
  societyName: string;
}) {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [flatId, setFlatId] = useState('');
  const [relationship, setRelationship] = useState<'OWNER' | 'TENANT'>(
    'TENANT',
  );
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const key = ['admin-invitations', userId, societyId];
  const flats = useQuery({
    queryKey: ['admin-flats', userId, societyId],
    queryFn: ({ signal }) =>
      api(
        `/societies/${societyId}/admin/flats`,
        z.object({ flats: z.array(flatSchema) }),
        undefined,
        signal,
      ),
  });
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/societies/${societyId}/admin/invitations${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        invitationListSchema,
        undefined,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const create = useMutation({
    gcTime: 0,
    mutationFn: (input: ReturnType<typeof invitationInput.parse>) =>
      api(
        `/societies/${societyId}/admin/invitations`,
        invitationCreatedSchema,
        input,
      ),
    onSuccess: async (result) => {
      setToken(result.token);
      create.reset();
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    gcTime: 0,
    mutationFn: (id: string) =>
      api(
        `/societies/${societyId}/admin/invitations/${id}/revoke`,
        successSchema,
        {},
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  function submit() {
    setError('');
    const parsed = invitationInput.safeParse({ email, flatId, relationship });
    if (!parsed.success) {
      setError('Enter a valid email address and select the intended flat.');
      return;
    }
    create.mutate(parsed.data);
  }
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <Label>Invite a resident</Label>
      <Copy>
        Create an invitation for a specific email and flat. They’ll sign in with
        that email to accept it.
      </Copy>
      {token ? (
        <Card>
          <Badge>Invitation created</Badge>
          <Label>Save this code before leaving.</Label>
          <Text
            selectable
            style={{ color: colors.ink, fontSize: 15, lineHeight: 24 }}
          >
            {token}
          </Text>
          <Copy small>
            This code is shown once and expires in seven days. It can only be
            accepted by {email.trim().toLowerCase()}.
          </Copy>
          <Button
            label="Share invitation"
            onPress={() =>
              void Share.share({
                message: `You’re invited to ${societyName} on Portl. Sign in with ${email.trim().toLowerCase()} and choose Accept an invitation. Invitation code: ${token}`,
              }).catch((e) => setError(messageOf(e)))
            }
          />
          <Button
            label="Done — I saved the code"
            variant="secondary"
            onPress={() => {
              setToken('');
              setEmail('');
              setFlatId('');
            }}
          />
        </Card>
      ) : (
        <Card>
          <Field
            label="Resident email"
            placeholder="resident@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={254}
            editable={!create.isPending}
          />
          {flats.isPending && <Loading label="Loading flats…" />}
          {flats.error && (
            <>
              <ErrorMessage message={messageOf(flats.error)} />
              <Button
                label="Retry flats"
                variant="secondary"
                onPress={() => void flats.refetch()}
              />
            </>
          )}
          {flats.data && (
            <FlatPicker
              flats={flats.data.flats}
              value={flatId}
              onChange={setFlatId}
            />
          )}
          <Row>
            <Choice
              label="Owner"
              selected={relationship === 'OWNER'}
              onPress={() => setRelationship('OWNER')}
            />
            <Choice
              label="Tenant"
              selected={relationship === 'TENANT'}
              onPress={() => setRelationship('TENANT')}
            />
          </Row>
          <ErrorMessage message={create.error ? messageOf(create.error) : ''} />
          <Button
            label="Create invitation"
            pending={create.isPending}
            disabled={!flatId}
            onPress={submit}
          />
        </Card>
      )}
      <ErrorMessage
        message={error || (revoke.error ? messageOf(revoke.error) : '')}
      />
      <Label>Invitation history</Label>
      <Button
        label="Refresh invitations"
        variant="secondary"
        onPress={() => void list.refetch()}
      />
      {list.isPending && <Loading label="Loading invitations…" />}
      {list.error && <ErrorMessage message={messageOf(list.error)} />}
      {!list.isPending && !list.error && !rows.length && (
        <Copy>No invitations yet.</Copy>
      )}
      {rows.map((item) => (
        <Card key={item.id}>
          <Badge>{item.status.toLowerCase()}</Badge>
          <Label>{item.email}</Label>
          <Copy>
            {item.flat.tower} · {item.flat.label} ·{' '}
            {item.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
          </Copy>
          <Copy small>
            Expires {new Date(item.expiresAt).toLocaleDateString('en-IN')}
          </Copy>
          {item.status === 'ACTIVE' && (
            <Button
              label="Revoke invitation"
              variant="secondary"
              pending={revoke.isPending && revoke.variables === item.id}
              disabled={revoke.isPending}
              onPress={() => revoke.mutate(item.id)}
            />
          )}
        </Card>
      ))}
      {list.hasNextPage && (
        <Button
          label="Load more invitations"
          variant="secondary"
          pending={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
        />
      )}
    </>
  );
}
