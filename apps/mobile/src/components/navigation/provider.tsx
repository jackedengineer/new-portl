import { useState, type ReactNode } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useSession } from '../../auth/session';
import { resolveContext, type Selection } from './model';
import type { GateView } from '@portl/contracts';
import { NavigationContext } from './context';

const routeRole: Record<string, GateView> = {
  '/admin': 'ADMIN',
  '/society-operations': 'ADMIN',
  '/notice-editor': 'ADMIN',
  '/register-visitor': 'GUARD',
  '/verify-guest-pass': 'GUARD',
  '/create-guest-pass': 'RESIDENT',
  '/directory': 'RESIDENT',
};
const standalone = new Set([
  '/',
  '/login',
  '/verify',
  '/reviewer',
  '/deletion-status',
  '/apply',
  '/invitation',
]);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{
    societyId?: string;
    view?: string;
    filter?: string;
    section?: string;
  }>();
  const [selected, setSelected] = useState<Selection & { userId: string }>();
  const me = session.me;
  const memberships = me?.memberships ?? [];
  const currentSelection =
    selected?.userId === me?.user.id ? selected : undefined;
  const view =
    params.view ?? (params.societyId ? routeRole[pathname] : undefined);
  const context = resolveContext(
    memberships,
    { societyId: params.societyId, view },
    currentSelection,
  );
  const societyId = context?.member.society.id,
    role = context?.role,
    userId = me?.user.id;
  if (selected && selected.userId !== me?.user.id) setSelected(undefined);
  // Remember a validated route context before rendering a destination without society params.
  if (
    params.societyId &&
    societyId &&
    role &&
    userId &&
    (selected?.societyId !== societyId ||
      selected.role !== role ||
      selected.userId !== userId)
  ) {
    setSelected({ societyId, role, userId });
  }
  const available =
    !!me &&
    !me.policyRequired &&
    !me.reviewLifecycle &&
    !session.loading &&
    !session.error;
  const visible = available && !!context && !standalone.has(pathname);
  function select(selection: Selection) {
    if (
      !me ||
      !available ||
      !resolveContext(memberships, {
        societyId: selection.societyId,
        view: selection.role,
      })
    )
      return;
    setSelected({ ...selection, userId: me.user.id });
    router.replace({
      pathname:
        selection.role === 'ADMIN'
          ? '/society-operations'
          : selection.role === 'GUARD'
            ? '/visitors'
            : '/community',
      params: { societyId: selection.societyId, view: selection.role },
    });
  }
  return (
    <NavigationContext.Provider
      value={{
        context,
        memberships,
        available,
        visible,
        pathname,
        params,
        select,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
