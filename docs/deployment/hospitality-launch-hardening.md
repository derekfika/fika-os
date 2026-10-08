# Post-RC Hospitality lifecycle email and price hardening — 8 October 2026

Scope: Hospitality/Integration Hub staging only. Starting main/origin:
`e0df8ecf2a054cc6cc96424f87492cf9c71ff962`. This work is **post-RC**; the frozen
RC remains `63512b705c5c3c9cbd6c0b31e0deffe3f6f4d6c3`, all five gates PASS,
GO WITH RECORDED P2/P3. No historical UAT or RC freeze was repeated. Menu templates,
Slides layout and menu-generation behavior are outside this change.

## Legacy behavior and reuse

- `sites/mnk/booking-platform/06_EmailService.js` and equivalent RCoA/CFC/Angel Court
  files use synchronous Apps Script `MailApp.sendEmail` after saving the request.
  The customer receives a request reference, company/contact, date/time, guests,
  location and estimated net total, explicitly subject to confirmation. Exceptions
  are caught so an email failure does not imply a lost booking. No durable retry.
  `name` is site-scoped; no explicit From or Reply-To is passed, so the executing
  Apps Script account supplies the underlying identity.
- `sites/mnk/dashboard/09_QuoteEngine.js` (and CFC/Angel Court/demo/58 Victoria
  Embankment equivalents) sends quote/confirmation/cancellation with MailApp and
  GmailApp. Confirmation is sent on completion; cancellation can notify the host.
  Subjects identify lifecycle and service date. Confirmation contains booking,
  location and menu/order summaries; the legacy confirmation explicitly excludes
  prices. Cancellation identifies the booking/service/date/location. Quote/calendar
  artifact handling is separate; the inspected lifecycle sends have no attachments
  or explicit From/Reply-To. No distinct durable amendment email was found.
- Hub already had `lib/booking-notifications.ts` and `fikaBookingNotifications`:
  submitted internal notifications, client confirmations/cancellations, deterministic
  booking/kind/version IDs, and an optional synchronous webhook. That implementation
  is extended, **not replaced by a second notification collection**. The webhook
  send path is retired. Legacy useful wording and HTML summaries remain; the public
  acknowledgement and current price summary are added. Earlier stored emails are
  never reconstructed, migrated, bulk-reissued or overwritten by a new revision.

## Lifecycle and durable delivery

New booking ingestion creates one request-received obligation atomically with the
Booking and its existing audit record. It addresses the customer and retains configured
site notification recipients as CC. The canonical Send to CPU transition creates the
confirmation in the same transaction. Amend and cancellation transitions create new
obligations for their exact Booking versions; the existing explicit `notify:false`
cancellation choice remains respected. Amendment wording states that the updated
request is subject to renewed confirmation, matching the workflow that reopens the
quote. No generated menu attachments are added.

Identity is `booking:<canonicalBookingId>:<kind>:<bookingVersion>`, with immutable
subject/text/HTML, OPLOC, commercial version and booking revision. The compatibility
confirmation callback can only report an already recorded obligation; it cannot
manufacture a fresh historical confirmation. Workers recheck exact Booking/commercial
version and OPLOC, lifecycle state, and lease ownership before the send barrier.
Superseded messages become held dead letters; no stale confirmation is sent.

`POST /api/internal/booking-email-outbox` uses existing internal service-token authority.
It selects only pending/failed due rows, ordered and limited to 25. The adapter reuses
shared durable-outbox claims, 60-second leases, 30-second retry delay and ten-attempt
dead-letter policy. Terminal records explicitly lose root retry eligibility, independent
of the recorded shared-package discrepancy. Delivered state stores Gmail's message
receipt, actual From/Reply-To/account and a hash of the sent MIME. Earlier immutable
content remains; attempt and recovery subcollections retain
delivery evidence. Missing sender/auth fails delivery, not the saved booking.

Gmail `messages.send` has no documented idempotency key. A deterministic RFC Message-ID
is correlation evidence, **not a promised Gmail deduplication mechanism**. A durable
send barrier is committed before network I/O; concurrent workers cannot send twice.
An expired armed claim, transport timeout, 5xx or missing receipt is held for operator
review. It is never automatically resent. Definite retryable rejection (401/403/429)
can retry; sender/auth failures before send can retry. This avoids claiming impossible
exactly-once delivery across a Gmail acceptance/Firestore acknowledgement crash.

`POST /api/internal/booking-email-replay` requires the exact notification ID, a reason,
provider evidence and `confirmedNotSent:true`. It refuses delivered or superseded
obligations. Verify provider non-delivery first, especially for an armed/uncertain
attempt. Recovery saves prior delivery state and evidence before resetting the same
obligation; it preserves message identity/content and prior attempt history. No recovery
or Gmail send was performed against staging during this task.

Email delivery is **disabled** by default, including explicit false in Hub staging
configuration. No Scheduler is enabled for this new worker until Workspace setup and
safe test-recipient approval are complete. New obligations may accumulate truthfully;
do not turn delivery on without reviewing that queue.

## Sender and Google authentication architecture

Configure `FIKA_HOSPITALITY_EMAIL_SENDERS_JSON` on the **Hub**, keyed by confirmed
canonical OPLOC IDs. Never use a manager UID, display label or guessed RCoA OPLOC.
For example, after verification:

```json
{
  "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f": {
    "from": "mnk@fikacatering.com",
    "replyTo": "mnk@fikacatering.com",
    "displayName": "MNK Catering",
    "authenticatedAccount": "REPLACE_WITH_VERIFIED_WORKSPACE_ACCOUNT@fikacatering.com",
    "verifiedSendAs": true,
    "enabled": ["submitted", "confirmed", "amended", "cancelled"]
  }
}
```

RCoA uses its actual governed OPLOC with `rcoa@fikacatering.com` / `RCOA Catering`.
The **From** is the visible site identity; **Reply-To** is the site's reply destination;
**authenticatedAccount** is the underlying Gmail mailbox. A multi-site manager has
no influence on any of them. Missing/unverified configuration holds delivery; there
is no silent fallback to the manager or a generic From.

Google requires the site's From to be an authorized, verified send-as identity of
the authenticated mailbox (or that mailbox's primary identity). `verifiedSendAs`
records the Workspace owner's verification; send-only scope cannot inspect send-as
settings. The code does not create aliases, change Gmail settings or spoof arbitrary
From addresses. Alias availability has **not** been verified by mailbox API access.

- Existing Hospitality `scripts/google-menu-auth.mjs` requests Drive + presentations,
  not Gmail by default. An explicit `--gmail-send` opt-in now adds send-only consent
  while retaining Drive/Slides scopes; the script was syntax-checked, never executed.
  Existing Hub `scripts/auth-gmail.ts` requests Gmail **readonly** for Angel
  Court inbox scanning; it is not repurposed or granted broader mailbox access here.
- Required additional email scope: `https://www.googleapis.com/auth/gmail.send` only.
  No mailbox-read or settings scope is required by this worker.
- Existing OAuth client supports this additional Google scope once Gmail API is enabled
  and explicit consent is granted. Existing refresh-token JSON format supports it.
  Refresh cannot add an unconsented scope. The local worker reuses Hub's existing
  OAuth file/refresh helpers with `GOOGLE_OAUTH_CLIENT_FILE` and
  `GOOGLE_OAUTH_TOKEN_FILE`, verifies declared send consent, and checks
  `FIKA_GMAIL_AUTH_ACCOUNT` against configured sender ownership. It does not run the
  consent tool, overwrite token files, or print credentials.
- Drive and Gmail can use the same explicitly authorized account/client/token if that
  account also has the needed Drive ownership and Gmail send-as identities. Each API's
  grants and ownership remain independent. A separate existing send credential may
  be preferable operationally; this task creates none.
- Hosted staging uses the existing Workspace DWD credential mechanism, with a JWT
  scoped **only** to Gmail send and the configured underlying account as subject.
  `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` already exists in the project by
  read-only secret-name inspection. Hub does not yet bind that secret; tomorrow's
  authorized activation must add the existing binding and service-account access.
  Its contents and delegated scopes were not read; DWD Gmail authorization remains
  a manual prerequisite. Drive token helpers and authorization remain unchanged.

References: [Google messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send),
[Google send-as identities](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs),
[domain-wide delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority).

## Public price authority

Root cause: Hub checked finite browser prices then copied `unitPrice`, `lineTotal`
and `netTotal` into canonical Booking state. Newer portals also had a client-snapshot
compatibility exception. Hub now matches active site/provider catalogue IDs and
recalculates prices/lines/net/gross on the server. Canonical Menu Item prices win;
MNK requires a canonical mapping. Newer portal compatibility catalogues are shared
server-owned data used by both Hospitality's existing read API and Hub. Unknown,
ambiguous, retired/withdrawn and invalid-price items fail closed; a known retired
canonical item cannot fall back to an older brochure. Options are checked against
the catalogue. Browser totals are ignored; mismatches produce bounded validation
warnings while original submitted payload evidence is retained.

Existing net-only public ingestion VAT remains zero; later quote generation still
applies the existing VAT/labour/hire/additional-charge rules. No price/VAT model is
redesigned. Existing request payload shape remains compatible. Shared catalogue
extraction changes ownership/imports only; generator scripts write the single shared
JSON catalogue location so the portal and Hub cannot silently diverge.

Read budget: public catalogue compatibility is a module-local immutable snapshot.
New Booking ingestion keeps the existing entity/lifecycle-scoped canonical query,
adds retired records to avoid stale fallback, and fails above 500 catalogue rows;
exact Booking retries read one document and create no new obligations. Worker idle
disabled mode reads zero Firestore documents. Enabled candidate selection reads at
most 25 rows plus direct Booking/notification reads for claim/arm/finish (five direct
reads per successful attempt, transaction retries additional). No audit pageview writes,
mailbox scans, broad subscriptions or high-frequency UI polling are added.

## Validation and activation handoff

Local evidence under `artifacts/uat/post-rc-*`: final focused Hub 44/44 PASS including real Firestore
email transitions/CAS/recovery 2/2 PASS; shared durable-outbox 3/3 PASS; Hospitality
full 100/100 PASS. Full Hub initially 509 tests: 497 PASS / 12 FAIL; literal starting
commit in-memory baseline 497 tests: 485 PASS / the **same 12 FAIL**. Failures cover
existing address/canonical boundary/BrightHR completeness/Connections source fixtures,
Delivered-In synthetic access, Logistics trace and Service Definition read-package
fixtures. No full-suite green claim. Initial baseline harness path/inventory errors
were corrected; only `post-rc-hub-baseline-verified.log` is baseline evidence.

Both affected production builds pass after Windows sandbox SWC access failure was
resolved by rerunning with authorized local access. No credential/token recreation
was performed: Derek renewed his expired Cloud login himself. Final typechecks,
builds, source SHA and staging rollout evidence are recorded in the task return and
canonical UAT report. Style Guide compliance PASS: existing email surfaces are reused;
no app screen/template/layout redesign. Email MIME uses inline email-compatible styling.

Tomorrow Derek must:

1. Confirm underlying Workspace mailbox(s), canonical RCoA OPLOC and each site's
   From/Reply-To/name. Verify MNK/RCoA send-as identities manually in Workspace/Gmail.
2. Enable Gmail API if necessary. For hosted DWD, explicitly authorize Gmail send-only
   on the existing delegated client; bind the existing DWD secret to Hub. For local
   OAuth, explicitly authorize additional send scope without accidentally discarding
   existing Drive/Slides consent (`npm run auth:google-menu -- --gmail-send`, only
   when Derek intends to replace the local token with new explicit consent). No
   tooling was run to create/revoke/re-consent tokens.
3. Configure OPLOC-keyed senders. Review queued obligations and stale revisions before
   activation. Choose an approved safe staging recipient/mechanism; no arbitrary
   customer test email is authorized by this task.
4. Only after a safe recipient test and operator approval, enable the delivery switch
   and create a bounded Scheduler POST to the internal worker using the existing
   internal service token (limit 25; sensible cadence, e.g. every minute). Verify
   index READY and inspect receipts/attempt history. Keep production separate.
5. For held attempts, obtain provider non-delivery evidence before deliberate replay.
   Never infer that an RFC Message-ID alone makes Gmail retries safe.

No blocker requires a new business-model choice. Sender mailbox/alias authority and
activation require Derek's Workspace setup. Production is untouched. CHANGELOG and
MNK MenuData were never edited/staged/restored/committed; explicit protection overrides
the normal changelog rule. This document records the task instead.

Initial cloud deployment exposed a clean-install import issue: Hub maintenance
scripts imported the Hospitality app's wrapper files, whose dependency resolution
relied on a sibling node_modules directory locally. Both scripts now import the
shared catalogue directly. No maintenance script was executed against staging.
Hub typecheck, production build and the 10 behavioural hardening tests were rerun.
Hospitality's initial rollout succeeded; Hub's failed build never replaced traffic.

## Changed files (implementation and build correction)

- `apps/hospitality-booking/docs/rcoa-hospitality-mapping.md`
- `apps/hospitality-booking/lib/hospitality-menu-catalogue.ts`
- `apps/hospitality-booking/lib/local-angel-court-menu.ts`
- `apps/hospitality-booking/lib/local-cfc-menu.ts`
- `apps/hospitality-booking/lib/local-mnk-menu.ts`
- `apps/hospitality-booking/lib/local-munich-re-menu.ts`
- `apps/hospitality-booking/lib/local-rcoa-menu.ts`
- `apps/hospitality-booking/scripts/convert-mnk-menu.mjs`
- `apps/hospitality-booking/scripts/convert-rcoa-menu.mjs`
- `apps/hospitality-booking/scripts/google-menu-auth.mjs`
- `apps/integration-hub/app/api/internal/booking-email-outbox/route.ts`
- `apps/integration-hub/app/api/internal/booking-email-replay/route.ts`
- `apps/integration-hub/apphosting.staging.yaml`
- `apps/integration-hub/firestore.indexes.json`
- `apps/integration-hub/lib/booking-email-delivery.ts`
- `apps/integration-hub/lib/booking-email-firestore.ts`
- `apps/integration-hub/lib/booking-email-outbox.ts`
- `apps/integration-hub/lib/booking-notifications.ts`
- `apps/integration-hub/lib/hospitality-booking-service.ts`
- `apps/integration-hub/lib/hospitality-price-trust.ts`
- `apps/integration-hub/lib/production-domain.ts`
- `apps/integration-hub/scripts/create-site-menu-offerings.ts`
- `apps/integration-hub/scripts/promote-local-portal-menu-items.ts`
- `apps/integration-hub/tests/booking-email-firestore.test.ts`
- `apps/integration-hub/tests/hospitality-booking-service.test.ts`
- `apps/integration-hub/tests/hospitality-launch-hardening.test.ts`
- `apps/integration-hub/tests/hospitality-projection-boundaries.test.ts`
- `docs/deployment/hospitality-launch-hardening.md`
- `docs/uat/autonomous-launch-uat-2026-10-07.md`
- `packages/server-shared/package.json`
- `packages/server-shared/src/hospitality-catalogue/hospitality-menu-catalogue.ts`
- `packages/server-shared/src/hospitality-catalogue/index.ts`
- `packages/server-shared/src/hospitality-catalogue/local-angel-court-menu.ts`
- `packages/server-shared/src/hospitality-catalogue/local-cfc-menu.ts`
- `packages/server-shared/src/hospitality-catalogue/local-mnk-menu.ts`
- `packages/server-shared/src/hospitality-catalogue/local-munich-re-menu.ts`
- `packages/server-shared/src/hospitality-catalogue/local-rcoa-menu.ts`
- `packages/server-shared/src/hospitality-catalogue/mnk-hospitality-menu.v1.json`
- `packages/server-shared/src/hospitality-catalogue/rcoa-hospitality-menu.v1.json`

## Final post-RC staging acceptance — 8 October 2026

Implementation committed/pushed as `0143f74e4f13354d157e29cfddc6b4504b899928`.
Hub clean-install build correction committed/pushed as
`9b747cc10d22c34c132b9cd0b25601fef27c06e0`: two existing maintenance scripts now
import shared catalogue directly rather than the Hospitality wrapper. The initial
Hub build failed before traffic changed. Corrected local typecheck/build and 10/10
hardening tests PASS; corrected cloud compilation/typechecking/build also PASS.
No maintenance/migration script ran against staging.

Verified live provenance through App Hosting build source, rollout and traffic:

| Staging backend | Exact source SHA | Build / rollout ID | Acceptance |
| --- | --- | --- | --- |
| Integration Hub (`fika-os-staging`) | `9b747cc10d22c34c132b9cd0b25601fef27c06e0` | `uat-1008214827-9b747cc` | READY / SUCCEEDED / current 100% / not reconciling |
| Hospitality (`fika-hospitality-staging`) | `0143f74e4f13354d157e29cfddc6b4504b899928` | `uat-1008214306-0143f74` | READY / SUCCEEDED / current 100% / not reconciling |

Email candidate index `fikaBookingNotifications/CICAgNi4-ZIK` is READY in staging.
Safe live acceptance on the verified source:

- Both internal worker/replay POST routes without service token return HTTP 403.
- Authorized worker POST returns HTTP 200, `enabled:false`, `attempted:0`.
  This proves the deployment kill switch; it does not claim live Gmail delivery.
- Public bridge submission with an intentionally unknown item and tampered prices
  returns HTTP 422, unknown/retired catalogue item. Pricing validation occurs before
  transaction writes, so this rejection created no booking/email obligation.
- Hospitality CFC reference-data read returns HTTP 200 with 37 catalogue items.

No real customer email, Gmail send, OAuth consent/replacement, alias change,
Scheduler activation, dead-letter manufacture or cloud booking mutation occurred.
Actual Gmail construction/receipt/retry/uncertainty and lifecycle transitions were
proven with mocks and isolated local Firestore tests. Terminal selection, exact
retry, immutable earlier messages, revision guards and sender routing passed those
behavioural tests. Delivery activation remains deliberately pending Derek's manual
Workspace/mailbox/send-as/send-only grant and approved safe-recipient setup.

Local evidence: `artifacts/uat/post-rc-final-provenance.json`,
`post-rc-live-acceptance.json`, `post-rc-hospitality-live-read.json`,
`post-rc-email-index-ready.json`, and validation logs described above. Evidence stays
local; runtime data/secrets are not committed. Final report commits are documentation
only and do not alter either deployed application SHA.

Protected SHA256 values reverified unchanged. HEAD equals origin/main after final
report push/fetch. Unrelated existing protected-file edits and untracked audit/artifact
files remain preserved; they are not part of this task's commits. Production untouched.
Gates 1–5 and the previously frozen RC remain authoritative and were not rerun/refrozen.
