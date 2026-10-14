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
    res.type('html').send(
      page(
        'Privacy notice',
        `<p>Version ${POLICY_VERSION}. Effective 14 October 2026. Portl is an India-first society-management portfolio app for adults aged 18 and over, operated by jackedengineer. Contact ${contact} for privacy questions, access, correction, deletion or complaints.</p>
          <h2>What we collect and why</h2>
          <ul>
            <li><strong>Account and security:</strong> email, name, account and session identifiers, verified sign-in state, age attestation and policy acceptance. Email codes secure sign-in, email changes, deletion and admin recovery. Admin authentication also uses encrypted authenticator material. Sessions may include network-address and device user-agent details; security rate limits help prevent abuse.</li>
            <li><strong>Society operations:</strong> society, tower and flat information, resident applications, owner/tenant relationship, memberships, invitations, guard assignments and administrative audit events. These records control which community workflows you can access.</li>
            <li><strong>Gate activity:</strong> visitor or guest name, category, optional company, destination flat/gate, approval decisions, guest-pass validity and entry/exit times. We store guest-pass credentials in encrypted form and use them to verify admission. We do not request visitor phone numbers, photos or identity documents.</li>
            <li><strong>Community content:</strong> notice titles and text, staff/service-provider names, service descriptions and optional directory phone numbers. Do not enter financial, health, identity-document or other unnecessary sensitive information.</li>
            <li><strong>Notifications and diagnostics:</strong> notification identifiers, read/delivery state, platform, session-bound encrypted push tokens and delivery error codes. Application logs contain request identifiers, timestamps, methods and status/error information. Hosting and push providers also process connection and device metadata needed to operate their services.</li>
            <li><strong>Support and recovery:</strong> details you send to the support email. Operator-assisted recovery records an operation, operator identifier and private verification-case reference. Do not email passwords, sign-in codes, authenticator secrets or private keys.</li>
          </ul>
          <h2>Who can see information</h2>
          <p>Admins manage their own society. Assigned guards see gate workflows. Residents see their flat's authorized gate activity and published society notices. Directory phone numbers are visible to residents only when an admin explicitly enables sharing; guards do not receive directory contact access. Admins must obtain permission before entering another person's contact details. Society access does not authorize unrelated use of visitor or staff information.</p>
          <p>When you use the native share action for a guest pass, its guest name, destination, valid window and admission code go to the recipient and app you choose. Treat the code as private. We cannot recall copies saved by recipients.</p>
          <h2>Production hosting and service providers</h2>
          <p>The production API at <a href="https://api.portl.jacked.dev">api.portl.jacked.dev</a> and its background worker run on Railway in California, United States. The production PostgreSQL database is hosted by Neon on AWS in Singapore. A separate private Railway volume in California holds hashed account-deletion recovery records. These locations are outside India; processing is not restricted to India. During development-build testing, the operator's computer also supplies the JavaScript bundle and receives debugging/connection information through Expo; it does not host the production API.</p>
          <p>Support emails are received in the operator's Gmail mailbox under that service's settings. Resend receives email addresses, verification-email content and delivery metadata to send transactional codes. Resend states that stored email data is held in the United States; choosing a sending region does not change its storage location. Better Auth is software running in our API, with account data in Neon, rather than a separate hosted authentication provider.</p>
          <p>If you enable alerts, Expo Push Service forwards a device delivery identifier, generic alert text and an opaque notification ID to Google Firebase Cloud Messaging (Android) or Apple Push Notification service (iOS). Push payloads do not include visitor names, flat labels, notice text or guest-pass codes. These providers operate international infrastructure; we do not promise a single-country push-processing location. Expo states that message content stays in delivery memory/queues only as needed for forwarding.</p>
          <p>You can use Portl without enabling push. Turning it off stops Portl alerts and disables its server registration; operating-system or Firebase installation identifiers may still be processed independently by the native push service, including before Portl registration. Account deletion does not itself delete a Firebase installation identifier. Google's published removal period of up to 180 days applies after an explicit installation-ID deletion request, not automatically when a Portl account is deleted.</p>
          <p>We do not sell personal data or use advertising, Firebase Analytics, crash-reporting or product-analytics SDKs. We do not upload your address book or request camera, microphone or device-location access for V1 workflows. Operational and provider diagnostics still exist. Providers have their own security, service-data and retention practices; see <a href="https://railway.com/legal/privacy">Railway</a>, <a href="https://neon.com/privacy-policy">Neon</a>, <a href="https://resend.com/security">Resend</a>, <a href="https://docs.expo.dev/push-notifications/faq/">Expo</a> and <a href="https://firebase.google.com/support/privacy">Firebase</a>.</p>
          <h2>Storage and retention</h2>
          <ul>
            <li>Account, society, gate, guest-pass, notice and directory history has no automatic expiry in V1. It remains until applicable account/content erasure or operator removal. Archiving a notice or expiring a pass hides or disables it; neither erases its history. Use fictional society, visitor and staff details during portfolio testing. Contact ${contact} for correction or erasure of data entered about you by another person.</li>
            <li>Sign-in sessions expire after seven days. Verification codes expire after five minutes; expired challenges and sessions are removed by maintenance. Stale IP rate-limit records are removed after 24 hours plus the hourly maintenance interval.</li>
            <li>Notification inbox records and stale Portl device registrations are removed after 30 days; delivery diagnostics after 7 days. Disabling push, revoking a session or deleting an account disables the associated Portl registrations sooner. Scheduled cleanup depends on the worker being available and can take longer during an outage or backlog.</li>
            <li>Closed operator-recovery metadata is kept for 90 days and is erased on account deletion. Temporary recovery secrets are wiped on completion, cancellation or expiry cleanup; recovery proofs expire after five minutes.</li>
            <li>A minimal deletion receipt with a hashed former account ID, status and dates remains for 90 days after completion. A separate private recovery ledger keeps the hashed ID and expiry for 90 days after its last erasure attempt so deleted accounts are not revived by a database restore. A temporary email hash blocks stale sign-in races for ten minutes after completion and is cleared by the next hourly maintenance.</li>
            <li>Neon's production project currently has a restore-history window of 6 hours on its Free plan. This is a point-in-time recovery setting, not a guarantee that every provider copy is erased within that period. No separate Portl database export or Railway ledger-volume backup is configured as part of this deployment. Before restored data is made available, recorded account deletions must be reapplied using the current recovery ledger.</li>
            <li>Railway's current plan provides seven days of searchable application logs; a search window is not a guarantee of underlying provider erasure. Resend publishes 30 days for email/log data on standard Free, Pro and Scale plans and 7 days for its backups. Portl account deletion does not automatically purge those provider records or delivered email. Support correspondence is kept in the operator's mailbox until manually removed; request its removal through ${contact}.</li>
          </ul>
          <h2>Security and account deletion</h2>
          <p>Production connections use HTTPS/TLS, access is checked by society and role, and credentials such as authenticator secrets, push tokens and guest codes are encrypted in application storage. Portl content is not end-to-end encrypted: authorized society users, the operator and service providers can process the data needed to run the service.</p>
          <p>${deletionWarning}</p>
          <p>Use Account &amp; privacy in the app or the public <a href="/delete-account">web deletion flow</a>. A separate email code and the word DELETE confirm the request. Confirmation immediately revokes sessions and Portl push registrations. Database erasure normally finishes within a few minutes while the worker is available; failures retry and the private receipt shows status. Completed means erasure from the active Portl database, subject to the minimal retained records above. Previously delivered messages, recipient copies and provider retention cannot be recalled by that action.</p>
          <h2>Your choices and contact</h2>
          <p>You can decline push, sign out, revoke sessions, change a verified email, or withdraw from using Portl by deleting your account. You can ask ${contact} for access, correction, erasure, help with data entered by a society admin, or a privacy complaint. We verify identity and authority before disclosing or changing information. A resident's gate approval is not consent to unrelated visitor-data processing. Portl is restricted to adults; contact us if an under-18 account or unnecessary personal information has been entered.</p>
          <p>Material policy changes are presented through the app's policy-acceptance flow. This notice describes the current portfolio deployment; a wider society rollout will require a reviewed operational retention schedule, provider recovery procedures and applicable India/store requirements. It does not assert that store approval or legal certification has been obtained.</p>`,
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
