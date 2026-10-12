import { expect, it } from 'vitest';
import {
  administrationQuery,
  directoryCreateInput,
  endOccupancyInput,
  towerEditInput,
} from '@portl/contracts';
it('rejects forged sharing, tenant fields, oversized names and stale version shapes', () => {
  const input = {
    id: 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
    name: ' Plumber ',
    kind: 'SERVICE_PROVIDER',
    service: 'Plumbing',
    description: '',
    phone: null,
    sharePhone: false,
  };
  expect(directoryCreateInput.parse(input).name).toBe('Plumber');
  for (const extra of [
    { societyId: 'other' },
    { archived: true },
    { sharePhone: true },
    { phone: '123' },
    { name: 'x'.repeat(81) },
  ])
    expect(directoryCreateInput.safeParse({ ...input, ...extra }).success).toBe(
      false,
    );
  expect(
    towerEditInput.safeParse({ name: 'A', expectedVersion: 0 }).success,
  ).toBe(false);
  expect(administrationQuery.safeParse({ archived: 'yes' }).success).toBe(
    false,
  );
  expect(
    endOccupancyInput.safeParse({ expectedStartedAt: 'yesterday' }).success,
  ).toBe(false);
});
