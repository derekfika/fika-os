# Hospitality cancellation recovery and RCoA notifications - 2026-10-19

## Scope and provenance

- Branch: `codex/hospitality-cancellation-email-integration`.
- Start: `origin/main` `d4a62b091b1c650abcfe134d2e48624d150f49e6`, fetched before work.
- Explicitly authorised isolated worktree: `C:/Fika/fika-os-cancellation-email`.
- Ported the reviewed service, outbox, API, contract and regression-test changes from `1930822ff0b0be816133fea73ebd12c2cf75d7b1` using a three-way patch against consolidated main. Application of the selected changes was clean.
- Excluded the old dashboard/group TSX and UI-specific test changes so Claude can finish grouped-booking UI independently. No charge editor, visual change, other feature branch or production configuration was imported.

## Cancellation and notification semantics

Cancellation remains authorised by `canonical.edit` and the stored Booking OPLOC at the authenticated Hub routes. Group cancellation authorises all affected sites inside its transaction. Existing safe withdrawal, durable versioned CPU obligations, Logistics reconciliation, historical-receipt identity checks and late-production review behaviour are preserved.

The authenticated standalone and group cancellation routes now supply the trusted `customer-cancellation` event. It is not a client JSON field. The service defaults to `internal-reconciliation` for other callers. Only a newly committed RCoA cancellation under the customer event queues customer mail; `notify` is a legacy UI option and cannot opt in or out. Other sites never gain cancellation mail through `notify:true`.

Booking cancellation, existing audit evidence, notification creation and safe CPU withdrawal obligations share the authoritative Firestore transaction. The notification ID uses the existing booking/kind/version identity. A retry of an already-cancelled Booking/group performs downstream recovery without creating a notification, incrementing the cancellation version, or recreating old customer evidence. Legacy cancelled records are not silently emailed. Group customer cancellation queues one existing-format notice per newly cancelled child service, not an extra group summary.

The existing branded v3 template, customer recipient, empty RCoA CC, production OPLOC allowlist, fixed-fixture controls, historical exclusions and Gmail worker/claim/send barrier are unchanged. `notificationOutcome: queued` records queuing, not successful Gmail delivery; delivery truth remains in the existing notification/outbox record. Submitted/confirmed/amended generation remains unchanged.

One integration correction scopes the dedicated cancellation-outbox dispatch to cancel commands only. The original port otherwise routed standalone amendments through a non-existent cancellation obligation and silently skipped their existing CPU retirement handoff. A real emulator regression observed zero CPU requests before this correction and one correct withdrawal request afterwards, while preserving the amended email.

## Validation

All final focused tests passed: **104/104**, no skips:

| Scope | Cases |
| --- | --- |
| New cancellation policy and actual Hub POST routes | 8/8 |
| Group/standalone recovery, legacy/newer-order reconciliation, amendment compatibility, Firestore email worker | 15/15 |
| Hub workflow, templates, launch/recipient/exclusion guards, authorisation and fulfilment contracts | 42/42 |
| Hospitality group lifecycle/CPU/presentation and credentialed proxy consumers | 39/39 |

New route regressions exercise the real Next POST handlers and real isolated Firestore. Only Firebase session-token verification is stubbed; identity lookup, server canonical.edit enforcement, Booking mutation, audit and notification transactions are real. Coverage includes absent/false notify; concurrent standalone calls and repeat workers; grouped once-per-service mail; all-or-nothing group rollback on a notification collision; viewer denial; legacy/internal retries; other-site exclusion; signed/advanced production preservation. Existing partial CPU-failure recovery tests now also assert the original queued customer notification survives CPU/Logistics retries unchanged.

Integration Hub and Hospitality `npm run typecheck`: PASS. Both `npm run build`: PASS. Hub build/typecheck repeated only after the bounded amendment correction. Diff checks: PASS. No CPU/Logistics/Menu/Delivered-In implementation changed, so their full suites/builds were not repeated.

Test commands and initial/final logs: `C:/Users/derek/AppData/Local/Temp/fika-cancellation-email-c7wpeqq7/`; `verified.py` contains exact focused test commands and demo-runtime environment. The isolated Firestore project was `demo-fika-os` on an unoccupied loopback port (8194). Only task-owned emulator processes were stopped. Gmail transport was mocked; no real email, customer artifact, staging or production data was created. Build-generated brand assets/next-env churn in this new worktree was saved to logs and restored to approved tracked contents.

## Operational and UI handoff

1. This is a backend/API integration candidate, ready for review/main integration, not production deployment approval. No main merge or deployment occurred.
2. Claude owns dashboard/group UI integration. Wire the new group POST proxy `/api/booking-groups/cancel`; retain the source hash and reason. Consume each service's cancellation outcome. Distinguish Booking cancelled from downstream `pending` and `review_required`; neither means active CPU/delivery work has stopped. Keep retry accessible after cancellation. Do not copy the obsolete 1930822f UI text saying no customer email is sent: new RCoA customer cancellations queue automatically, other sites remain unlaunched.
3. Recovery is durable but operator-driven in this scope: replay the authorised standalone/group cancellation POST to retry outstanding withdrawals. The three paused CPU/Logistics/Menu recovery schedulers were not enabled or changed. The new Hub cancellation outbox is not an assertion of automatic scheduler coverage.
4. Existing automatic Hub booking-email processing handles the queued notice; do not replay historical notifications or broaden allowlists. Uncertain Gmail acceptance still requires the existing evidence-based manual recovery, never a blind resend.
5. Before any later production release, integrate Claude's status/retry UI changes, resolve shared-contract overlaps deliberately, run a focused cancellation/notification UAT including pending CPU review and failed/retried downstream delivery, then obtain separate rollout approval. Potential app scope is Hub plus Hospitality; this task introduces no CPU or Logistics deployment requirement.

## Persistence, cost and safety

No migration/backfill is needed and none was executed. Authoritative queries remain limited to the affected Booking/group and associated Production Orders/requirements. Notification integration adds one deterministic-ID outbox create per newly cancelled RCoA child, no additional reads, polling or full-collection scan. It reuses existing audit/domain records rather than adding duplicate audit writes. No runtime manifests, secrets, AUTHMOD policy, IAM, production data or scheduler settings were changed. Existing branches and dirty worktrees were not edited.
