import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import {
  flatAdminListSchema,
  towerAdminListSchema,
  flatCreateInput,
  towerCreateInput,
  type TowerAdmin,
  type FlatAdmin,
} from '@portl/contracts';
import {
  Badge,
  Button,
  Card,
  Copy,
  ErrorMessage,
  Field,
  Label,
  Row,
} from '../../components/ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { useOperationCommand, useOperationList } from './request';
import { ListState } from './list-state';
function StructureForm({
  userId,
  societyId,
  tower,
  onClose,
}: {
  userId: string;
  societyId: string;
  tower?: TowerAdmin;
  onClose: () => void;
}) {
  const [id] = useState(randomUUID),
    [value, setValue] = useState(''),
    [error, setError] = useState('');
  const command = useOperationCommand(userId, societyId, onClose),
    { online } = useLiveGate();
  function save() {
    const result = tower
      ? flatCreateInput.safeParse({ id, towerId: tower.id, label: value })
      : towerCreateInput.safeParse({ id, name: value });
    if (!result.success) {
      setError('Enter a name or flat label up to 80 characters.');
      return;
    }
    setError('');
    command.mutate({
      path: `/administration/${tower ? 'flats' : 'towers'}`,
      body: result.data,
    });
  }
  return (
    <Card>
      <Label>{tower ? `Add a flat in ${tower.name}` : 'Add a tower'}</Label>
      <Field
        label={tower ? 'Flat label' : 'Tower name'}
        value={value}
        maxLength={80}
        onChangeText={setValue}
        editable={!command.isPending}
      />
      <ErrorMessage
        message={error || (command.error ? messageOf(command.error) : '')}
      />
      <Button
        label={tower ? 'Save flat' : 'Save tower'}
        disabled={!online}
        pending={command.isPending}
        onPress={save}
      />
      <Button
        label="Cancel new record"
        variant="quiet"
        disabled={command.isPending}
        onPress={onClose}
      />
    </Card>
  );
}
function StructureItem({
  userId,
  societyId,
  item,
  onAddFlat,
}: {
  userId: string;
  societyId: string;
  item: TowerAdmin | FlatAdmin;
  onAddFlat?: (tower: TowerAdmin) => void;
}) {
  const isFlat = 'label' in item,
    name = isFlat ? item.label : item.name;
  const [action, setAction] = useState<{
      type: 'edit' | 'archive';
      version: number;
    } | null>(null),
    [value, setValue] = useState(name),
    [error, setError] = useState('');
  const command = useOperationCommand(userId, societyId, () => setAction(null)),
    { online } = useLiveGate();
  function submit() {
    if (!action) return;
    if (action.type === 'edit' && (!value.trim() || value.trim().length > 80)) {
      setError('Enter a name up to 80 characters.');
      return;
    }
    setError('');
    command.mutate({
      path: `/administration/${isFlat ? 'flats' : 'towers'}/${item.id}/${action.type}`,
      body: {
        expectedVersion: action.version,
        ...(action.type === 'edit'
          ? { [isFlat ? 'label' : 'name']: value.trim() }
          : {}),
      },
    });
  }
  return (
    <Card>
      <Label>{isFlat ? `${item.tower} · ${name}` : name}</Label>
      <Badge>{item.archived ? 'Archived' : isFlat ? 'Flat' : 'Tower'}</Badge>
      {!item.archived && !action && (
        <Row>
          {!isFlat && onAddFlat && (
            <Button
              label={`Add flat in ${name}`}
              variant="secondary"
              disabled={!online}
              onPress={() => onAddFlat(item)}
            />
          )}
          <Button
            label={`Rename ${isFlat ? 'flat' : 'tower'} ${name}`}
            variant="secondary"
            disabled={!online}
            onPress={() => {
              command.reset();
              setValue(name);
              setAction({ type: 'edit', version: item.version });
            }}
          />
          <Button
            label={`Archive ${isFlat ? 'flat' : 'tower'} ${name}`}
            variant="quiet"
            disabled={!online}
            onPress={() => {
              command.reset();
              setAction({ type: 'archive', version: item.version });
            }}
          />
        </Row>
      )}
      {action && (
        <>
          {action.type === 'edit' ? (
            <Field
              label="Updated name or label"
              value={value}
              onChangeText={setValue}
              maxLength={80}
              editable={!command.isPending}
            />
          ) : (
            <Copy>
              {isFlat
                ? 'End current residencies, revoke invitations and review pending applications before archiving. Historical records are retained.'
                : 'Archive active flats first. Historical records are retained.'}
            </Copy>
          )}
          <ErrorMessage
            message={error || (command.error ? messageOf(command.error) : '')}
          />
          <Button
            label={
              action.type === 'edit'
                ? 'Save updated name'
                : 'Confirm archive record'
            }
            pending={command.isPending}
            disabled={!online}
            onPress={submit}
          />
          <Button
            label="Cancel change"
            variant="quiet"
            disabled={command.isPending}
            onPress={() => setAction(null)}
          />
        </>
      )}
    </Card>
  );
}
export function SocietyStructure({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const [archived, setArchived] = useState(false),
    [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [form, setForm] = useState<TowerAdmin | 'tower' | null>(null);
  const suffix = `?archived=${archived}&search=${encodeURIComponent(search)}`;
  const towers = useOperationList(
      userId,
      societyId,
      `/administration/towers${suffix}`,
      towerAdminListSchema,
    ),
    flats = useOperationList(
      userId,
      societyId,
      `/administration/flats${suffix}`,
      flatAdminListSchema,
    );
  return (
    <>
      <Copy>
        Keep your society’s towers and flats up to date. Archive unused records
        while retaining their history.
      </Copy>
      <Field
        label="Search towers and flats"
        value={input}
        onChangeText={setInput}
        maxLength={80}
      />
      <Row>
        <Button
          label="Search structure"
          variant="secondary"
          onPress={() => setSearch(input.trim())}
        />
        <Button
          label={archived ? 'Show active structure' : 'Show archived structure'}
          variant="secondary"
          onPress={() => setArchived(!archived)}
        />
        <Button
          label="Add tower"
          disabled={!towers.online}
          onPress={() => setForm('tower')}
        />
      </Row>
      {form && (
        <StructureForm
          key={form === 'tower' ? 'tower' : form.id}
          userId={userId}
          societyId={societyId}
          tower={form === 'tower' ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      <Label>Towers</Label>
      <ListState
        query={towers.query}
        empty={!towers.items.length}
        label="towers"
      />
      {towers.items.map((item) => (
        <StructureItem
          key={item.id}
          userId={userId}
          societyId={societyId}
          item={item}
          onAddFlat={setForm}
        />
      ))}
      <Label>Flats</Label>
      <ListState
        query={flats.query}
        empty={!flats.items.length}
        label="flats"
      />
      {flats.items.map((item) => (
        <StructureItem
          key={item.id}
          userId={userId}
          societyId={societyId}
          item={item}
        />
      ))}
      {!towers.online && (
        <Copy>
          You’re offline. Reconnect before changing society structure.
        </Copy>
      )}
    </>
  );
}
