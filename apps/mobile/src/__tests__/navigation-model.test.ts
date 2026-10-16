import type { Me } from '@portl/contracts';
import { resolveContext, navigationItems } from '../components/navigation/model';

const resident = {
  society: { id: 'society-a', name: 'Gardens', isDemo: true },
  roles: ['RESIDENT'],
  flats: [],
} as Me['memberships'][number];
const admin = {
  society: { id: 'society-b', name: 'Heights', isDemo: true },
  roles: ['ADMIN'],
  flats: [],
} as Me['memberships'][number];
it('uses the only membership automatically, but asks for context when several exist', () => {
  expect(resolveContext([resident], {})).toEqual({ member: resident, role: 'RESIDENT' });
  expect(resolveContext([resident, admin], {})).toBeNull();
});
it('does not carry a removed role or an invalid deep-link context into the navigation', () => {
  expect(resolveContext([resident], { societyId: 'society-a', view: 'ADMIN' })).toBeNull();
  expect(resolveContext([resident], { societyId: 'missing', view: 'RESIDENT' })).toBeNull();
  expect(resolveContext([resident], {}, { societyId: 'society-a', role: 'ADMIN' })).toBeNull();
});
it('follows a valid deep link rather than the previously selected society', () => {
  expect(resolveContext([resident, admin], { societyId: 'society-b', view: 'ADMIN' }, { societyId: 'society-a', role: 'RESIDENT' })).toEqual({ member: admin, role: 'ADMIN' });
});
it('keeps a multi-role membership selectable without inventing a default role', () => {
  const member = { ...resident, roles: ['RESIDENT', 'GUARD'] as const };
  expect(resolveContext([{ ...member, roles: [...member.roles] }], {})).toBeNull();
  expect(resolveContext([{ ...member, roles: [...member.roles] }], { societyId: member.society.id, view: 'GUARD' })?.role).toBe('GUARD');
});
it('routes every role to its own existing screens and keeps guard history explicit', () => {
  expect(navigationItems('RESIDENT').map(i=>i.label)).toEqual(['Home','Gate','Notices','More']);
  expect(navigationItems('ADMIN').map(i=>i.label)).toEqual(['Overview','Society','Notices','More']);
  const guard = navigationItems('GUARD');
  expect(guard.map(i=>i.label)).toEqual(['Gate','Passes','History','Account']);
  expect(guard[2]).toMatchObject({ pathname: '/visitors', filter: 'HISTORY' });
  expect(guard.map(i=>i.pathname)).not.toContain('/directory');
});
