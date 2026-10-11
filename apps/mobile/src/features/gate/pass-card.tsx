import type { ReactNode } from 'react';
import type { GuestPass } from '@portl/contracts';
import { Badge, Card, Copy, Label } from '../../components/ui';
import { istLabel } from './pass-time';
const statuses: Record<GuestPass['status'], string> = {
  SCHEDULED: 'Scheduled',
  READY: 'Ready to enter',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  INVALIDATED: 'No longer valid',
  INSIDE: 'Inside',
  COMPLETED: 'Visit completed',
};
export function PassCard({
  pass,
  children,
}: {
  pass: GuestPass;
  children?: ReactNode;
}) {
  return (
    <Card>
      <Badge>{statuses[pass.status]}</Badge>
      <Label>{pass.visitorName}</Label>
      <Copy>
        {pass.flat.tower} · {pass.flat.label}
      </Copy>
      <Copy small>
        {istLabel(pass.validFrom)} → {istLabel(pass.validUntil)}
      </Copy>
      <Copy small>One entry · one exit</Copy>
      {children}
    </Card>
  );
}
