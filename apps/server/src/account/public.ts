import express from 'express';
import {
  POLICY_VERSION,
  deletionChallengeSchema,
  deletionStatusSchema,
} from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import { DomainError } from '../registry/context.js';
import { deletionAction } from './router.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const contact =
  '<a href="mailto:trainwithchirag@gmail.com">trainwithchirag@gmail.com</a>';
const deletionWarning =
  'Deletion signs you out everywhere and removes your profile, memberships, applications, invitations, notifications, guest passes, notices you created and visitor records you registered. This also removes that content from other members’ history. It cannot be undone. Society buildings and unrelated members’ records remain; your identifying actor references on surviving operational records are removed. If you are the only admin, administration becomes unavailable until the operator verifies a replacement.';
function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} · Portl</title><link rel="stylesheet" href="/legal/style.css"></head><body><main><a href="/privacy">portl.</a><h1>${escape(title)}</h1>${content}<nav><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a> · <a href="/delete-account">Delete account</a></nav></main></body></html>`;
}
const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${name}" value="${escape(value)}">`;
const statusForm = (token = '') =>
  `<form method="post" action="/delete-account/status"><label>Deletion receipt<input name="receiptToken" value="${escape(token)}" required minlength="64" maxlength="64" autocomplete="off"></label><button>Check deletion status</button></form>`;
export function publicAccountRouter(auth: PortlAuth, baseURL: string) {
  const router = express.Router();
  router.get('/legal/style.css', (_req, res) =>
    res
      .type('css')
      .send(
        'body{margin:0;background:#f6f5f0;color:#173d32;font:17px/1.6 system-ui}main{max-width:680px;margin:auto;padding:28px 22px}h1{line-height:1.2}a{color:#173d32}form{display:grid;gap:16px;margin:24px 0}label{display:grid;gap:6px}input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #53665e;min-width:0}button{background:#173d32;color:white}nav{margin-top:32px}code{overflow-wrap:anywhere}',
      ),
  );
  router.get('/privacy', (_req, res) =>
    res
      .type('html')
      .send(
        page(
          'Privacy notice',
          `<p>Version ${POLICY_VERSION}. Portl is an India-first, adult-only portfolio application operated by jackedengineer. Contact ${contact} for privacy questions, correction, access requests or complaints.</p><h2>Information and purposes</h2><p>We use your email, name, verified sign-in sessions, age attestation and policy acceptance to secure your account. Operator-assisted admin recovery additionally records the operation, operator identifier and private verification-case reference. Temporary recovery secrets expire after five minutes and are wiped when recovery completes, is cancelled or hourly maintenance closes an expired request. Minimal closed recovery metadata is kept for 90 days and is removed if you delete your account. Society membership, flat occupancy and applications control community access. Visitor names, categories, approvals and entry/exit times support gate operations. Notices and directory details support society communication. Do not enter identity documents, financial, health or other unnecessary sensitive information.</p><p>Admins manage their society; guards see assigned gate workflows; residents see their flat’s gate requests and society notices. Directory phone numbers are shared with residents only when an admin explicitly enables sharing. Admins must obtain permission before adding other people’s contact information.</p><h2>Notifications and providers</h2><p>Push is optional. When enabled we store an encrypted push token linked to your session and use Expo, Google FCM or Apple APNs to deliver generic alerts. Resend delivers email codes. Neon hosts PostgreSQL. Development runs on the operator’s computer; the planned production API host is Railway. We do not run advertising, analytics SDKs, contact-book uploads or continuous location tracking.</p><p>Providers may process data outside India. Resend states email and log data are retained for 30 days on standard plans, with backups for 7 days. Provider regions and database backup windows must be verified before any public deployment; this development notice is not a claim that production hosting is active.</p><h2>Retention and deletion</h2><p>Gate history and notices remain while their society uses this development service, unless an account deletion removes them. Notification inbox records expire after 30 days. Expired authentication challenges are removed by hourly maintenance. Sessions expire after seven days and are removed by maintenance. Sign-in sessions may include IP and device user-agent details; expired IP rate-limit records are removed after 24 hours plus the hourly maintenance interval. You can revoke sessions earlier.</p><p>${deletionWarning}</p><p>Verified deletion immediately revokes sessions and push registrations. Database cleanup normally finishes within a few minutes while the worker is available; failures retry. A private receipt shows progress. A minimal deletion receipt (hashed former account ID, status and dates) is retained for 90 days to track completion. A separate private recovery ledger retains the hashed former account ID and expiry date for 90 days after its last erasure attempt to prevent restoration mistakes; an email hash blocks stale sign-in races for ten minutes after completion and is cleared at the next hourly maintenance.</p><p>“Completed” means removal from Portl’s active database. Previously delivered emails, notifications on devices and copies held by other recipients cannot be recalled. Database backups expire under the configured provider window; restored backups must have deletions reapplied before access resumes. Contact us for provider or backup questions. Public launch requires an actual backup/region inventory and reviewed retention schedule.</p><h2>Your choices</h2><p>Use Account &amp; privacy in the app or the <a href="/delete-account">web deletion flow</a> to delete without contacting support. You can decline push, sign out, revoke sessions, or ask ${contact} for access, correction, a privacy complaint or help if you lose access to your email. Identity verification is required before manual changes. Portl V1 is restricted to people aged 18 and over.</p>`,
        ),
      ),
  );
  router.get('/terms', (_req, res) =>
    res
      .type('html')
      .send(
        page(
          'Terms of use',
          `<p>Version ${POLICY_VERSION}. Portl is a portfolio-stage community app operated by jackedengineer, ${contact}. You must be at least 18, use an email you control and provide accurate membership information. A verified email does not automatically grant society access.</p><p>Use Portl only for authorized society operations. Do not impersonate anyone, bypass access controls, publish abusive or unlawful content, or include unnecessary sensitive information about visitors or staff. Admins are responsible for obtaining permission to share directory contacts. Report inappropriate content to support with its society and notice reference.</p><p>Portl is not an emergency service or a substitute for a guard’s physical checks. If network or notification delivery fails, follow your society’s manual gate process. No maintenance payments, polls, helpdesk or amenity bookings are included in V1.</p><p>${deletionWarning}</p>`,
        ),
      ),
  );
  router.get('/support', (_req, res) =>
    res
      .type('html')
      .send(
        page(
          'Support',
          `<p>Contact jackedengineer at ${contact}. Include the affected screen and a request ID if shown. Never send passwords, email codes, guest pass codes or private keys.</p><p>For privacy access/correction, content complaints, lost-mailbox recovery or sole-admin recovery, contact the same address. Recovery requires independent verification of identity and society authority; support does not grant a role merely because someone requests it. Routine account deletion is available directly <a href="/delete-account">here</a>.</p>`,
        ),
      ),
  );
  router.get('/delete-account', (_req, res) =>
    res
      .type('html')
      .send(
        page(
          'Delete your Portl account',
          `<p>${deletionWarning}</p><p>Enter your account email. If an eligible account exists, we will send a separate six-digit deletion code valid for five minutes. You do not need to install the app or contact support.</p><form method="post" action="/delete-account/start"><label>Account email<input type="email" name="email" required maxlength="254" autocomplete="email"></label><button>Request deletion code</button></form><h2>Already confirmed?</h2>${statusForm()}`,
        ),
      ),
  );
  router.post(
    '/delete-account/:action',
    express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 8 }),
    async (req, res) => {
      try {
        if (req.get('origin') !== new URL(baseURL).origin)
          throw new DomainError(
            403,
            'UNTRUSTED_ORIGIN',
            'Open the deletion page on this server before submitting',
          );
        if (!req.is('application/x-www-form-urlencoded'))
          throw new DomainError(
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'Use the deletion form',
          );
        const result = await deletionAction(
          auth,
          String(req.params.action),
          req.body,
          req.ip || '127.0.0.1',
        );
        if (req.params.action === 'start') {
          const challenge = deletionChallengeSchema.parse(result);
          res
            .type('html')
            .send(
              page(
                'Confirm account deletion',
                `<p>If an eligible account exists, a deletion code was requested. Delivery can fail; you can request another code after one minute. This code expires in five minutes.</p><p>${deletionWarning}</p><form method="post" action="/delete-account/confirm">${hidden('challengeId', challenge.challengeId)}${hidden('receiptToken', challenge.receiptToken)}<label>Email deletion code<input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label><label>Type DELETE to confirm<input name="confirmation" pattern="DELETE" required autocomplete="off"></label><button>Permanently delete account</button></form><p>Keep this private receipt to check status if the connection is interrupted: <code>${challenge.receiptToken}</code></p>${statusForm(challenge.receiptToken)}<a href="/delete-account">Request another code</a>`,
              ),
            );
        } else {
          const status = deletionStatusSchema.parse(result);
          res
            .type('html')
            .send(
              page(
                'Deletion status',
                `<p>${status.status === 'COMPLETED' ? 'Deletion from the active application database is complete. Provider and backup limits are explained in the privacy notice.' : 'Deletion confirmed. Sessions have been revoked; cleanup normally completes within a few minutes while the worker is available. You may close this page and return with your receipt.'}</p><p>Requested ${escape(status.requestedAt)}${status.completedAt ? ` · Completed ${escape(status.completedAt)}` : ''}</p><p>Keep this receipt private: <code>${escape(String(req.body.receiptToken))}</code></p>${statusForm(String(req.body.receiptToken))}`,
              ),
            );
        }
      } catch (error) {
        const known = error instanceof DomainError;
        if (known && error.status === 429) res.setHeader('retry-after', '60');
        res
          .status(known ? error.status : 500)
          .type('html')
          .send(
            page(
              'Unable to complete request',
              `<p>${escape(known ? error.message : 'Please try again later. If confirmation may have succeeded, check your receipt.')}</p><a href="/delete-account">Return to account deletion</a>`,
            ),
          );
      }
    },
  );
  return router;
}
