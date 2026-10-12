import { useState } from 'react';
import { directoryListSchema, type DirectoryEntry } from '@portl/contracts';
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
import { useOperationCommand, useOperationList } from './request';
import { ListState } from './list-state';
import { DirectoryEditor } from './directory-editor';
export function DirectoryBoard({
  userId,
  societyId,
  view,
}: {
  userId: string;
  societyId: string;
  view: 'ADMIN' | 'RESIDENT';
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<DirectoryEntry | 'new' | null>(null),
    [confirm, setConfirm] = useState<DirectoryEntry | null>(null);
  const { query, items, online } = useOperationList(
    userId,
    societyId,
    `/directory?view=${view}&search=${encodeURIComponent(search)}&archived=${archived}${filter ? `&kind=${filter}` : ''}`,
    directoryListSchema,
  );
  const command = useOperationCommand(userId, societyId, () =>
    setConfirm(null),
  );
  return (
    <>
      <Copy>
        Find the people who help your community. Only explicitly shared phone
        numbers appear for residents.
      </Copy>
      <Field
        label="Search directory"
        value={input}
        onChangeText={setInput}
        maxLength={80}
      />
      <Row>
        <Button
          label="Search contacts"
          variant="secondary"
          onPress={() => setSearch(input.trim())}
        />
        {[
          ['', 'All contacts'],
          ['STAFF', 'Staff'],
          ['SERVICE_PROVIDER', 'Service providers'],
        ].map(([value, label]) => (
          <Button
            key={value}
            label={label!}
            variant={filter === value ? 'primary' : 'secondary'}
            onPress={() => setFilter(value!)}
          />
        ))}
      </Row>
      {view === 'ADMIN' && (
        <Row>
          <Button
            label="Add contact"
            disabled={!online}
            onPress={() => setEditing('new')}
          />
          <Button
            label={archived ? 'Show active contacts' : 'Show archived contacts'}
            variant="secondary"
            onPress={() => setArchived(!archived)}
          />
        </Row>
      )}
      {editing && view === 'ADMIN' && (
        <DirectoryEditor
          key={editing === 'new' ? 'new' : editing.id}
          userId={userId}
          societyId={societyId}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ListState
        query={query}
        empty={!items.length}
        label="directory contacts"
      />
      {items.map((item) => (
        <Card key={item.id}>
          <Badge>
            {item.kind === 'STAFF' ? 'Society staff' : 'Service provider'}
            {item.archived ? ' · Archived' : ''}
          </Badge>
          <Label>{item.name}</Label>
          <Copy>{item.service}</Copy>
          {!!item.description && <Copy>{item.description}</Copy>}
          <Copy>{item.phone ?? 'No phone number shared'}</Copy>
          {view === 'ADMIN' && item.phone && (
            <Copy small>
              {item.sharePhone
                ? 'Phone shared with residents'
                : 'Phone visible to admins only'}
            </Copy>
          )}
          {view === 'ADMIN' && !item.archived && (
            <Row>
              <Button
                label={`Edit ${item.name}`}
                variant="secondary"
                disabled={!online || command.isPending}
                onPress={() => setEditing(item)}
              />
              <Button
                label={`Archive ${item.name}`}
                variant="quiet"
                disabled={!online || command.isPending}
                onPress={() => {
                  command.reset();
                  setConfirm(item);
                }}
              />
            </Row>
          )}
        </Card>
      ))}
      {confirm && (
        <Card>
          <Label>Archive {confirm.name}?</Label>
          <Copy>
            This removes the contact from the resident directory. The admin
            record is retained.
          </Copy>
          <ErrorMessage
            message={command.error ? messageOf(command.error) : ''}
          />
          <Button
            label="Confirm archive contact"
            pending={command.isPending}
            disabled={!online}
            onPress={() =>
              command.mutate({
                path: `/administration/directory/${confirm.id}/archive`,
                body: { expectedVersion: confirm.version },
              })
            }
          />
          <Button
            label="Keep contact"
            variant="quiet"
            disabled={command.isPending}
            onPress={() => setConfirm(null)}
          />
        </Card>
      )}
      {!online && (
        <Copy>
          You’re offline. Reconnect to refresh contacts or make changes.
        </Copy>
      )}
    </>
  );
}
