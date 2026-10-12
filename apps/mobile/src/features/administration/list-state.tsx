import { Button, Copy, ErrorMessage, Loading } from '../../components/ui';
import { messageOf } from '../../lib/api';
export function ListState({
  query,
  empty,
  label,
}: {
  query: {
    isPending: boolean;
    error: Error | null;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: () => unknown;
    fetchNextPage: () => unknown;
  };
  empty: boolean;
  label: string;
}) {
  return (
    <>
      {query.isPending && <Loading label={`Loading ${label}…`} />}
      {query.error && <ErrorMessage message={messageOf(query.error)} />}
      {!query.isPending && !query.error && empty && (
        <Copy>No {label} match this view.</Copy>
      )}
      <Button
        label={`Refresh ${label}`}
        variant="quiet"
        onPress={() => void query.refetch()}
      />
      {query.hasNextPage && (
        <Button
          label={`Load more ${label}`}
          variant="secondary"
          pending={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      )}
    </>
  );
}
