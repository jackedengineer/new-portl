import { createContext, useContext } from 'react';
import type { GateView, Me } from '@portl/contracts';
import type { CommunityContext } from './model';

type NavigationState = {
  context: CommunityContext | null;
  memberships: Me['memberships'];
  visible: boolean;
  pathname: string;
  params: { filter?: string; section?: string };
  select: (selection: { societyId: string; role: GateView }) => void;
};
export const NavigationContext = createContext<NavigationState | null>(null);
export const useCommunityNavigation = () => useContext(NavigationContext);
