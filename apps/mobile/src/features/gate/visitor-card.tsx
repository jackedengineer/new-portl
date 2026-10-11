import type { VisitorRequest } from '@portl/contracts';
import { Badge, Card, Copy, Label } from '../../components/ui';
export const categoryLabel = {
  GUEST: 'Guest',
  DELIVERY: 'Delivery',
  CAB: 'Cab',
  SERVICE: 'Service professional',
};
const labels = {
  PENDING: 'Awaiting resident',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  INVALIDATED: 'Approval no longer valid',
};
export function VisitorCard({
  request: r,
  children,
}: {
  request: VisitorRequest;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <Badge>
        {r.presence === 'INSIDE'
          ? 'Inside society'
          : r.presence === 'EXITED'
            ? 'Visit completed'
            : labels[r.status]}
      </Badge>
      <Label>{r.visitorName}</Label>
      <Copy>
        {categoryLabel[r.category]}
        {r.company ? ` · ${r.company}` : ''}
      </Copy>
      <Copy>
        {r.flat.tower} · {r.flat.label} · {r.gate.name}
      </Copy>
      <Copy small>
        Requested {new Date(r.createdAt).toLocaleString('en-IN')}
      </Copy>
      {children}
    </Card>
  );
}
