import { useQuery } from '@tanstack/react-query';
import { administrationSummarySchema } from '@portl/contracts';
import {
  Button,
  Card,
  Copy,
  ErrorMessage,
  Label,
  Loading,
  Row,
} from '../../components/ui';
import { messageOf } from '../../lib/api';
import { useLiveGate } from '../gate/live';
import { operationKey, useOperationRequest } from './request';
export function SocietyOverview({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const request = useOperationRequest(userId, societyId),
    { enabled } = useLiveGate();
  const query = useQuery({
    queryKey: [...operationKey(userId, societyId), 'overview'],
    queryFn: ({ signal }) =>
      request.call(
        '/administration/summary',
        administrationSummarySchema,
        undefined,
        signal,
      ),
    refetchInterval: enabled ? 15000 : false,
    refetchOnWindowFocus: 'always',
  });
  const labels = {
    towers: 'Active towers',
    flats: 'Active flats',
    residents: 'Current residents',
    pendingApplications: 'Pending applications',
    gates: 'Active gates',
    guards: 'Assigned guards',
    staff: 'Staff contacts',
    serviceProviders: 'Service providers',
  };
  return (
    <>
      <Copy>
        A current view of your society. Open the sections below to manage access
        and community contacts.
      </Copy>
      {query.isPending && <Loading label="Loading society overview…" />}
      {query.error && <ErrorMessage message={messageOf(query.error)} />}
      {!query.error && query.data && (
        <Row>
          {Object.entries(labels).map(([key, label]) => (
            <Card key={key}>
              <Label>{query.data[key as keyof typeof labels]}</Label>
              <Copy>{label}</Copy>
            </Card>
          ))}
        </Row>
      )}
      <Button
        label="Refresh overview"
        variant="secondary"
        onPress={() => void query.refetch()}
      />
    </>
  );
}
