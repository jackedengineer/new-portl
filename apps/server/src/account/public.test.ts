import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { POLICY_VERSION, policyAcceptanceInput } from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import { publicAccountRouter } from './public.js';

// Public GET pages do not invoke authentication or the database.
const app = express().use(
  publicAccountRouter({} as PortlAuth, 'https://api.portl.jacked.dev'),
);

it('discloses actual production hosting, provider retention and deletion limits publicly', async () => {
  const response = await request(app).get('/privacy');
  expect(response.status).toBe(200);
  expect(response.type).toBe('text/html');
  for (const fact of [
    '14 October 2026',
    'California, United States',
    'Singapore',
    '6 hours',
    'Resend',
    '30 days',
    '7 days',
    'Firebase installation',
    'no automatic expiry',
    'not end-to-end encrypted',
    'trainwithchirag@gmail.com',
    'href="/delete-account"',
  ])
    expect(response.text).toContain(fact);
  expect(response.text).not.toContain('planned production API host');
  expect(response.text).not.toContain('this development notice');
  // A recovery-history setting is not a promise of erasure from every backup.
  expect(response.text).toContain('not a guarantee that every provider copy');
});

it('requires the revised policy without silently accepting the earlier edition', () => {
  expect(POLICY_VERSION).toBe('2026-10-14');
  expect(
    policyAcceptanceInput.safeParse({
      adult: true,
      termsVersion: '2026-10-13',
      privacyVersion: '2026-10-13',
    }).success,
  ).toBe(false);
  expect(
    policyAcceptanceInput.safeParse({
      adult: true,
      termsVersion: POLICY_VERSION,
      privacyVersion: POLICY_VERSION,
    }).success,
  ).toBe(true);
});
