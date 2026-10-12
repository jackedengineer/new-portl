import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import {
  directoryCreateInput,
  directoryEditInput,
  type DirectoryEntry,
} from '@portl/contracts';
import {
  Button,
  Card,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Label,
} from '../../components/ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { useOperationCommand } from './request';
export function DirectoryEditor({
  userId,
  societyId,
  item,
  onClose,
}: {
  userId: string;
  societyId: string;
  item?: DirectoryEntry;
  onClose: () => void;
}) {
  const [id] = useState(randomUUID),
    [name, setName] = useState(item?.name ?? ''),
    [kind, setKind] = useState<DirectoryEntry['kind']>(item?.kind ?? 'STAFF');
  const [service, setService] = useState(item?.service ?? ''),
    [description, setDescription] = useState(item?.description ?? ''),
    [phone, setPhone] = useState(item?.phone ?? ''),
    [sharePhone, setSharePhone] = useState(item?.sharePhone ?? false),
    [error, setError] = useState('');
  const command = useOperationCommand(userId, societyId, onClose),
    { online } = useLiveGate();
  function save() {
    const fields = {
      name,
      kind,
      service,
      description,
      phone: phone.trim() || null,
      sharePhone,
    };
    const result = item
      ? directoryEditInput.safeParse({
          ...fields,
          expectedVersion: item.version,
        })
      : directoryCreateInput.safeParse({ ...fields, id });
    if (!result.success) {
      setError(
        'Enter a name and service, and a phone number with country code if sharing it.',
      );
      return;
    }
    setError('');
    command.mutate({
      path: `/administration/directory${item ? `/${item.id}/edit` : ''}`,
      body: result.data,
    });
  }
  return (
    <Card>
      <Label>{item ? 'Edit directory contact' : 'Add directory contact'}</Label>
      <Field
        label="Contact name"
        value={name}
        onChangeText={setName}
        maxLength={80}
        editable={!command.isPending}
      />
      <Choice
        label="Society staff"
        selected={kind === 'STAFF'}
        onPress={() => {
          if (!command.isPending) setKind('STAFF');
        }}
      />
      <Choice
        label="Service provider"
        selected={kind === 'SERVICE_PROVIDER'}
        onPress={() => {
          if (!command.isPending) setKind('SERVICE_PROVIDER');
        }}
      />
      <Field
        label="Service or responsibility"
        value={service}
        onChangeText={setService}
        maxLength={80}
        editable={!command.isPending}
      />
      <Field
        label="Community description"
        value={description}
        onChangeText={setDescription}
        maxLength={500}
        multiline
        editable={!command.isPending}
      />
      <Copy small>
        Residents can see the name, service and description. Keep private
        details out of the description.
      </Copy>
      <Field
        label="Phone number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+919876543210"
        maxLength={16}
        editable={!command.isPending}
      />
      <Choice
        label="Share this phone number with residents"
        role="checkbox"
        selected={sharePhone}
        onPress={() => {
          if (!command.isPending) setSharePhone(!sharePhone);
        }}
      />
      <Copy small>
        Enable sharing only after the contact agrees. Otherwise the number stays
        with society admins.
      </Copy>
      <ErrorMessage
        message={error || (command.error ? messageOf(command.error) : '')}
      />
      {!online && <Copy>Reconnect before saving this contact.</Copy>}
      <Button
        label="Save contact"
        pending={command.isPending}
        disabled={!online}
        onPress={save}
      />
      <Button
        label="Cancel editing"
        variant="quiet"
        disabled={command.isPending}
        onPress={onClose}
      />
    </Card>
  );
}
