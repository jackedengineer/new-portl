import { useState } from 'react';
import type { Flat } from '@portl/contracts';
import {
  Button,
  Choice,
  Copy,
  ErrorMessage,
  Field,
  Label,
} from '../../components/ui';

export function FlatPicker({
  flats,
  value,
  onChange,
  hasMore = false,
  loadingMore = false,
  loadError,
  onLoadMore,
  onRefresh,
}: {
  flats: Flat[];
  value: string;
  onChange: (value: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadError?: string;
  onLoadMore?: () => void;
  onRefresh?: () => void;
}) {
  const [search, setSearch] = useState('');
  const selected = flats.find((flat) => flat.id === value);
  const matches = flats.filter((flat) =>
    `${flat.tower} ${flat.label}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  return (
    <>
      <Label>Select your flat</Label>
      <Field
        label="Search tower or flat"
        placeholder="e.g. A 101"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
      />
      {selected && (
        <Copy>
          Selected: {selected.tower} · {selected.label}
        </Copy>
      )}
      {matches.slice(0, 8).map((flat) => (
        <Choice
          key={flat.id}
          label={`${flat.tower} · ${flat.label}`}
          selected={value === flat.id}
          onPress={() => onChange(flat.id)}
        />
      ))}
      {matches.length > 8 && (
        <Copy small>Type a tower or flat number to narrow the results.</Copy>
      )}
      {!matches.length && (
        <Copy>
          {hasMore
            ? 'No matches in loaded flats. Load more flats to continue searching.'
            : 'No flats match. Check with the society office if your flat is missing.'}
        </Copy>
      )}
      <ErrorMessage message={loadError ?? ''} />
      {!!loadError && onRefresh && (
        <Button label="Refresh flats" variant="secondary" onPress={onRefresh} />
      )}
      {hasMore && onLoadMore && (
        <Button
          label="Load more flats"
          variant="secondary"
          pending={loadingMore}
          onPress={onLoadMore}
        />
      )}
    </>
  );
}
