import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import {
  applicationInput,
  applicationSchema,
  lookupSchema,
  societyLookupInput,
} from '@portl/contracts';
import { useSession } from '../../auth/session';
import { api, messageOf } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Row,
  Screen,
  Title,
} from '../../components/ui';
import { FlatPicker } from '../../features/onboarding/flat-picker';

export default function Apply() {
  const { refresh } = useSession();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [flatId, setFlatId] = useState('');
  const [relationship, setRelationship] = useState<'OWNER' | 'TENANT'>(
    'TENANT',
  );
  const [error, setError] = useState('');
  const lookup = useMutation({
    mutationFn: (value: string) =>
      api('/onboarding/society-lookup', lookupSchema, { code: value }),
  });
  const application = useMutation({
    mutationFn: (input: ReturnType<typeof applicationInput.parse>) =>
      api(
        `/societies/${lookup.data!.society.id}/applications`,
        applicationSchema,
        input,
      ),
    onSuccess: async () => {
      await refresh();
      router.replace('/community');
    },
  });
  function find() {
    setError('');
    const parsed = societyLookupInput.safeParse({ code });
    if (!parsed.success) {
      setError('Enter the 12-character code shared by your society admin.');
      return;
    }
    setCode(parsed.data.code);
    lookup.mutate(parsed.data.code);
  }
  function submit() {
    setError('');
    const parsed = applicationInput.safeParse({
      name,
      flatId,
      relationship,
      societyCode: code,
    });
    if (!parsed.success) {
      setError('Enter your name and select your flat to continue.');
      return;
    }
    application.mutate(parsed.data);
  }
  return (
    <Screen back eyebrow="Resident application">
      <Title>A place in your community.</Title>
      <Copy>
        Your society admin will verify these details before giving you access.
      </Copy>
      {!lookup.data ? (
        <>
          <Field
            label="Society code"
            placeholder="12-character society code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            editable={!lookup.isPending}
            onSubmitEditing={find}
          />
          <Copy small>
            Ask your society office for this code. It helps us find the right
            community.
          </Copy>
          <ErrorMessage
            message={error || (lookup.error ? messageOf(lookup.error) : '')}
          />
          <Button
            label="Find my society"
            pending={lookup.isPending}
            onPress={find}
          />
        </>
      ) : (
        <>
          <Card>
            <Badge>
              {lookup.data.society.isDemo
                ? 'Demo society'
                : 'Your selected society'}
            </Badge>
            <Copy>{lookup.data.society.name}</Copy>
            <Button
              label="Change society"
              variant="quiet"
              disabled={application.isPending}
              onPress={() => {
                lookup.reset();
                setFlatId('');
                setError('');
              }}
            />
          </Card>
          <Field
            label="Full name"
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            textContentType="name"
            autoComplete="name"
            maxLength={80}
            editable={!application.isPending}
          />
          <FlatPicker
            flats={lookup.data.flats}
            value={flatId}
            onChange={setFlatId}
          />
          <Row>
            <Choice
              label="I’m an owner"
              selected={relationship === 'OWNER'}
              onPress={() => setRelationship('OWNER')}
            />
            <Choice
              label="I’m a tenant"
              selected={relationship === 'TENANT'}
              onPress={() => setRelationship('TENANT')}
            />
          </Row>
          <Copy small>
            This is a request for society access. It does not verify legal
            ownership of a property.
          </Copy>
          <ErrorMessage
            message={
              error || (application.error ? messageOf(application.error) : '')
            }
          />
          <Button
            label="Send application"
            pending={application.isPending}
            disabled={!flatId}
            onPress={submit}
          />
        </>
      )}
    </Screen>
  );
}
