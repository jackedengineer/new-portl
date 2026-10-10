import { describe, expect, it } from 'vitest';
import {
  applicationInput,
  invitationInput,
  societyLookupInput,
} from '@portl/contracts';

describe('resident admission input', () => {
  it('rejects privileged role injection and unbounded fields', () => {
    expect(
      applicationInput.safeParse({
        societyCode: 'AB12CD34EF56',
        name: 'A Resident',
        flatId: 'flat-1',
        relationship: 'OWNER',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
    expect(
      invitationInput.safeParse({
        email: 'a@example.com',
        flatId: 'flat-1',
        relationship: 'TENANT',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
    expect(
      applicationInput.safeParse({
        societyCode: 'AB12CD34EF56',
        name: 'x'.repeat(81),
        flatId: 'flat-1',
        relationship: 'OWNER',
      }).success,
    ).toBe(false);
  });
  it('normalizes emails and shared society codes', () => {
    expect(
      invitationInput.parse({
        email: ' A@Example.COM ',
        flatId: 'flat-1',
        relationship: 'TENANT',
      }).email,
    ).toBe('a@example.com');
    expect(societyLookupInput.parse({ code: ' ab12cd34ef56 ' }).code).toBe(
      'AB12CD34EF56',
    );
  });
});
