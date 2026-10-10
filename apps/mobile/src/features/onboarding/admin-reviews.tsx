import { useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  applicationListSchema,
  type DecisionInput,
  type ResidentApplication,
} from '@portl/contracts';
import { api, messageOf, successSchema } from '../../lib/api';
import {
  Button,
  Card,
  Choice,
  Copy,
  ErrorMessage,
  Label,
  Loading,
  Row,
} from '../../components/ui';

function ReviewItem({
  item,
  societyId,
  onDecided,
}: {
  item: ResidentApplication;
  societyId: string;
  onDecided: () => void;
}) {
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState<
    | 'DETAILS_COULD_NOT_BE_VERIFIED'
    | 'INCORRECT_FLAT'
    | 'CONTACT_SOCIETY_OFFICE'
  >('CONTACT_SOCIETY_OFFICE');
  const mutation = useMutation({
    mutationFn: (input: DecisionInput) =>
      api(
        `/societies/${societyId}/admin/applications/${item.id}/decision`,
        successSchema,
        input,
      ),
    onSuccess: onDecided,
  });
  return (
    <Card>
      <Label>{item.name}</Label>
      <Copy>
        {item.flat.tower} · {item.flat.label} ·{' '}
        {item.relationship === 'OWNER' ? 'Owner' : 'Tenant'}
      </Copy>
      <Copy small>
        Requested {new Date(item.createdAt).toLocaleDateString('en-IN')}
      </Copy>
      {!action ? (
        <Row>
          <Button label="Approve" onPress={() => setAction('APPROVE')} />
          <Button
            label="Decline"
            variant="secondary"
            onPress={() => setAction('REJECT')}
          />
        </Row>
      ) : (
        <>
          <Copy>
            {action === 'APPROVE'
              ? 'Confirm you have verified this person’s residency. Approval gives them resident access to this society.'
              : 'Choose the reason the resident will see.'}
          </Copy>
          {action === 'REJECT' && (
            <>
              <Choice
                label="Details could not be verified"
                selected={reason === 'DETAILS_COULD_NOT_BE_VERIFIED'}
                onPress={() => setReason('DETAILS_COULD_NOT_BE_VERIFIED')}
              />
              <Choice
                label="Incorrect flat details"
                selected={reason === 'INCORRECT_FLAT'}
                onPress={() => setReason('INCORRECT_FLAT')}
              />
              <Choice
                label="Contact the society office"
                selected={reason === 'CONTACT_SOCIETY_OFFICE'}
                onPress={() => setReason('CONTACT_SOCIETY_OFFICE')}
              />
            </>
          )}
          <ErrorMessage
            message={mutation.error ? messageOf(mutation.error) : ''}
          />
          <Button
            label={
              action === 'APPROVE' ? 'Confirm approval' : 'Confirm decline'
            }
            pending={mutation.isPending}
            onPress={() =>
              mutation.mutate(
                action === 'APPROVE'
                  ? { decision: 'APPROVE' }
                  : { decision: 'REJECT', reason },
              )
            }
          />
          <Button
            label="Cancel"
            variant="quiet"
            disabled={mutation.isPending}
            onPress={() => setAction(null)}
          />
        </>
      )}
    </Card>
  );
}
export function AdminReviews({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  const client = useQueryClient();
  const key = ['admin-applications', userId, societyId];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/societies/${societyId}/admin/applications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        applicationListSchema,
        undefined,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <Label>Resident applications</Label>
      <Copy>
        Review residency before granting access. Pending applications can’t use
        society services.
      </Copy>
      {query.isPending && <Loading label="Loading applications…" />}
      {query.error && <ErrorMessage message={messageOf(query.error)} />}
      <Button
        label="Refresh applications"
        variant="secondary"
        onPress={() => void query.refetch()}
      />
      {!query.isPending && !query.error && !items.length && (
        <Card>
          <Label>All caught up.</Label>
          <Copy>No applications are waiting for your review.</Copy>
        </Card>
      )}
      {items.map((item) => (
        <ReviewItem
          key={item.id}
          item={item}
          societyId={societyId}
          onDecided={() => void client.invalidateQueries({ queryKey: key })}
        />
      ))}
      {query.hasNextPage && (
        <Button
          label="Load more applications"
          variant="secondary"
          pending={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      )}
    </>
  );
}
