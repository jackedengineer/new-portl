import { gateView, idSchema, type Me } from '@portl/contracts';
export function gateRoute(me: Me | null, societyId: unknown, view: unknown) {
  const sid = idSchema.safeParse(societyId),
    role = gateView.safeParse(view);
  if (!sid.success || !role.success) return null;
  const member = me?.memberships.find(
    (m) => m.society.id === sid.data && m.roles.includes(role.data),
  );
  return member ? { member, view: role.data } : null;
}
