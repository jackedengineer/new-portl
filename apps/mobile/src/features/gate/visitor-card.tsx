import type { VisitorRequest } from '@portl/contracts';
import { Badge, Card, Copy } from '../../components/ui';
import { Identity } from '../../components/identity';
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
      <Badge
        tone={
          r.status === 'PENDING'
            ? 'warning'
            : r.status === 'REJECTED'
              ? 'danger'
              : 'neutral'
        }
      >
        {r.presence === 'INSIDE'
          ? 'Inside society'
          : r.presence === 'EXITED'
            ? 'Visit completed'
            : labels[r.status]}
      </Badge>
      <Identity
        title={r.visitorName}
        icon={
          r.category === 'DELIVERY'
            ? 'package'
            : r.category === 'CAB'
              ? 'truck'
              : r.category === 'SERVICE'
                ? 'tool'
                : 'user'
        }
      />
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
