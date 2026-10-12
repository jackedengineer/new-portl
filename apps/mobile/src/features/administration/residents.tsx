import { useState } from 'react';
import { residentAdminListSchema, type ResidentAdmin } from '@portl/contracts';
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
export function SocietyResidents({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const [past, setPast] = useState(false),
    [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [confirm, setConfirm] = useState<ResidentAdmin | null>(null);
  const { query, items, online } = useOperationList(
    userId,
    societyId,
    `/administration/residents?archived=${past}&search=${encodeURIComponent(search)}`,
    residentAdminListSchema,
  );
  const command = useOperationCommand(userId, societyId, () =>
    setConfirm(null),
  );
  return (
    <>
      <Copy>
        Review each resident’s flat access. Use Applications and Invitations to
        admit residents.
      </Copy>
      <Field
        label="Search resident name, email or flat"
        value={input}
        maxLength={80}
        onChangeText={setInput}
      />
      <Row>
        <Button
          label="Search residents"
          variant="secondary"
          onPress={() => setSearch(input.trim())}
        />
        <Button
          label={past ? 'Show current residents' : 'Show ended residencies'}
          variant="secondary"
          onPress={() => setPast(!past)}
        />
      </Row>
      <ListState query={query} empty={!items.length} label="residencies" />
      {items.map((item) => (
        <Card key={item.id}>
          <Label>{item.name}</Label>
          <Copy>{item.email}</Copy>
          <Copy>
            {item.tower} · {item.flat} ·{' '}
            {item.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
          </Copy>
          <Copy small>
            Since {new Date(item.startedAt).toLocaleDateString('en-IN')}
          </Copy>
          <Badge>
            {item.endedAt ? 'Residency ended' : 'Current residency'}
          </Badge>
          {item.endedAt ? (
            <Copy small>
              Ended {new Date(item.endedAt).toLocaleDateString('en-IN')}
            </Copy>
          ) : (
            <Button
              label={`End residency for ${item.name}`}
              variant="secondary"
              disabled={!online || command.isPending}
              onPress={() => {
                command.reset();
                setConfirm(item);
              }}
            />
          )}
        </Card>
      ))}
      {confirm && (
        <Card>
          <Label>End this flat’s residency?</Label>
          <Copy>
            {confirm.name} · {confirm.tower} · {confirm.flat}
          </Copy>
          <Copy>
            This removes access for this residency. Other current flats remain
            active. Ending the last flat removes resident access to this society
            and revokes outstanding resident invitations. Historical gate
            records remain.
          </Copy>
          <ErrorMessage
            message={command.error ? messageOf(command.error) : ''}
          />
          <Button
            label="Confirm end residency"
            pending={command.isPending}
            disabled={!online}
            onPress={() =>
              command.mutate({
                path: `/administration/occupancies/${confirm.id}/end`,
                body: { expectedStartedAt: confirm.startedAt },
              })
            }
          />
          <Button
            label="Keep residency"
            variant="quiet"
            disabled={command.isPending}
            onPress={() => setConfirm(null)}
          />
        </Card>
      )}
      {!online && <Copy>Reconnect before changing residency access.</Copy>}
    </>
  );
}
