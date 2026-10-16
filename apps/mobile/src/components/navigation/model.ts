import type { GateView, Me } from '@portl/contracts';

export type Selection = { societyId: string; role: GateView };
export type CommunityContext = { member: Me['memberships'][number]; role: GateView };
export const roleLabels: Record<GateView, string> = {
  RESIDENT: 'Resident', GUARD: 'Security guard', ADMIN: 'Society admin',
};

// Presentation context only. Existing route guards and server permissions remain authoritative.
export function resolveContext(
  memberships: Me['memberships'],
  params: { societyId?: unknown; view?: unknown },
  selected?: Selection,
): CommunityContext | null {
  const societyId = params.societyId ?? selected?.societyId;
  const role = params.view ?? (params.societyId === undefined ? selected?.role : undefined);
  if (societyId !== undefined) {
    const member = memberships.find(m => m.society.id === societyId);
    if (!member) return null;
    const matchingRole = role ?? (member.roles.length === 1 ? member.roles[0] : undefined);
    return member.roles.some(r => r === matchingRole)
      ? { member, role: matchingRole as GateView }
      : null;
  }
  return memberships.length === 1 && memberships[0]!.roles.length === 1
    ? { member: memberships[0]!, role: memberships[0]!.roles[0]! }
    : null;
}

type NavigationItem = {
  label: string;
  icon: 'home' | 'grid' | 'file-text' | 'more-horizontal' | 'shield' | 'credit-card' | 'clock' | 'user';
  pathname: '/community' | '/visitors' | '/notices' | '/account' | '/verify-guest-pass' | '/society-operations';
  filter?: 'HISTORY';
};
export function navigationItems(role: GateView): NavigationItem[] {
  if (role === 'GUARD') return [
    { label: 'Gate', icon: 'shield', pathname: '/visitors' },
    { label: 'Passes', icon: 'credit-card', pathname: '/verify-guest-pass' },
    { label: 'History', icon: 'clock', pathname: '/visitors', filter: 'HISTORY' },
    { label: 'Account', icon: 'user', pathname: '/account' },
  ];
  if (role === 'ADMIN') return [
    { label: 'Overview', icon: 'home', pathname: '/society-operations' },
    { label: 'Society', icon: 'grid', pathname: '/community' },
    { label: 'Notices', icon: 'file-text', pathname: '/notices' },
    { label: 'More', icon: 'more-horizontal', pathname: '/account' },
  ];
  return [
    { label: 'Home', icon: 'home', pathname: '/community' },
    { label: 'Gate', icon: 'shield', pathname: '/visitors' },
    { label: 'Notices', icon: 'file-text', pathname: '/notices' },
    { label: 'More', icon: 'more-horizontal', pathname: '/account' },
  ];
}
