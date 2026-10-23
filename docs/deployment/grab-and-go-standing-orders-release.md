# Grab & Go standing orders — production release and Commerzbank UAT

Status: **prepared, not executed.** Nothing here has been merged, deployed, scheduled or written to production. Every step marked **[OWNER]** needs Derek's explicit instruction. Design: [grab-and-go-standing-orders.md](grab-and-go-standing-orders.md).

## 1. Release facts

| Item | Value |
|---|---|
| App | `delivered-in` only (production backend `fika-os-prod-deliveredin`, project `fika-os`, `europe-west4`). Hub is **not** redeployed: only its Firestore index file and a test change. |
| Data | Additive. New record types in `fikaDeliveredInGrabAndGoStandingOrdersV1`; two optional fields (`source`, `control`) on new/changed orders. No migration, no backfill, no existing record is read differently. |
| Indexes | Two composite indexes in `apps/integration-hub/firestore.indexes.json` (`recordType`+`oplocId`+`version desc`, `recordType`+`oplocId`+`at desc`). Only the History panel needs them; the scheduler scan and all order paths use equality filters / known ids. If an index is missing the History panel says it is unavailable and everything else works. |
| Scheduler | None created. Generator endpoint is token-only and inert until called. |
| Lane | Operational/data-sensitive. The repository's release policy decides the lane from the full delta; **do not assume the cosmetic fast track**. Run `fika deploy delivered-in --prod` (dry run) after merge to see the lane; if it requires a verified staging deployment of the same tree, that is a safeguard to satisfy (a plain staging deploy + smoke, not a business UAT cycle), not one to bypass. |

## 2. Production deployment sequence (all **[OWNER]**-authorised, in order)

1. CI: `Workflow / merge-gate` green on the PR. Merge by merge-commit PR on explicit instruction.
2. **Indexes first.** Deploy the two Firestore indexes to project `fika-os` using the existing Firestore index deployment practice (`firebase deploy --only firestore:indexes --project fika-os --config apps/integration-hub/firebase.json`) and wait until both are `READY` (`gcloud firestore indexes composite list --project fika-os`). Indexes are additive and safe to precede the app.
3. Read-only census against production to confirm nothing uses or collides with the v2 shape:
   `npx tsx scripts/standing-uat-report.ts census --project fika-os` (from `apps/delivered-in`, operator ADC). Expect `no existing record uses or collides with the v2 schema`. The script performs reads only.
4. If the lane requires it: `fika deploy delivered-in --staging --execute`, then smoke.
5. `fika deploy delivered-in --prod --execute --owner-approved --reason "<Derek's instruction>"` (dry run first). Do not disable any safeguard.
6. Production smoke (non-writing): `/api/build-info` reports the released SHA; unauthenticated `POST /api/internal/grab-and-go-standing-orders` → 403; signed-in Grab & Go page loads and shows the **Orders | Standing orders** tabs; Standing tab loads for an eligible site (shows "Not set up" and the next generation time); `gcloud scheduler jobs list --project fika-os --location europe-west4` shows **no** standing-order job.
7. Run Commerzbank UAT (section 4). The scheduler stays off.

## 3. Production data authority

- Production is the only dataset that matters. Staging's three legacy standing-order records are ignored and never touched.
- Existing production orders/handoffs are never modified by this release. Generated and manual orders share ids, so a manual order always wins and a cancelled date is never recreated.
- The census and UAT report scripts are read-only (reads only; no HTTP, no writes) and refuse to run without `--project`.

## 4. Commerzbank live UAT — how it will be done

Commerzbank's canonical OPLOC in the governed list is `oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c`. **Nothing is hard-coded**: the site appears in the picker only if the production Hub grants Derek Grab & Go access to it (service arrangement active, AUTHMOD scope). Eligibility is therefore confirmed by Commerzbank appearing in the picker; this was **not** verified against the live Hub from this workspace (no production session).

**Everything below that writes (template, order) is a genuine production write and starts only when Derek says so.**

1. **Preflight (read-only):** census (above); Derek confirms Commerzbank appears under Grab & Go; Derek lists the real quantities per rotation week/day.
2. **Configure** [Derek]: Standing orders tab → pick each rotation week/day → real quantities → *Save draft*. Writes one template head + version (no order).
3. **Activate** [Derek]: dialog states that no order is created. Writes a template version.
4. **Create one real order** [Derek, explicit approval of the date]: the Upcoming deliveries list offers *Create now…* only for the next two open deliveries (cut-off enforced). Pick the date Derek is content to be real. This writes one genuine Grab & Go order + handoff.
5. **Verify** (read-only): `npx tsx scripts/standing-uat-report.ts report --project fika-os --oploc oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c --date <YYYY-MM-DD>` prints the Delivered-In order (product ids, quantities, rotation week, source version, control, source template version), handoff events per version, the Hub Production Order (status, source version, lines) and the Logistics Fulfilment Requirement, plus a reconciliation block (version/status/quantities match). Then look at the same date in Delivered-In (Orders and Standing tabs), CPU Production (Grab & Go planned order) and Logistics (fulfilment/delivery list).
6. **Amendment** [Derek]: change one quantity of the slot → *Save amendment*. Expect the open automatic order to become v2, a v2 handoff, and the Hub/Logistics requirement to show the new quantity. Also amend that day's order from the Orders tab: it becomes *Manual*, and a later template amendment must leave it alone.
7. **Cancellation** [Derek]: **important** — in the existing ordering flow a cancelled date cannot be re-submitted, so cancel only a date that can stay cancelled. Test on the second eligible date (create it first), either by cancelling that single order on the Orders tab, or by *Pause generation* → *Cancel automatic orders*. Expect: order cancelled, CPU/Logistics requirement withdrawn, unrelated orders unchanged. Simulating a CPU outage is **not** part of live UAT (covered by emulator tests).
8. **Unrelated orders:** the report for a date that already had a manual Commerzbank order must show it untouched and "skipped-manual-order" semantics (manual always wins).
9. Sign-off: Derek records sign-off; only then is the scheduler considered.

## 5. Scheduler activation after sign-off — **[OWNER]** approval required, not created by this work

Same convention as the existing outbox jobs ([cpu-durable-outbox-scheduler.md](cpu-durable-outbox-scheduler.md)): Cloud Scheduler HTTP job, internal token from Secret Manager, `Europe/London` time zone. Three small jobs (all idempotent; any can be retried or run twice):

| Job | Schedule (London) | Purpose |
|---|---|---|
| `fika-delivered-in-standing-orders-mon` | `1 12 * * 1` | Monday 12:01 → Wednesday's order |
| `fika-delivered-in-standing-orders-thu` | `1 12 * * 4` | Thursday 12:01 → next Monday's order |
| `fika-delivered-in-standing-orders-recovery` | `1 9,15 * * *` | Missed-run recovery until each cut-off (creates nothing if the primary runs succeeded) |

```powershell
$token = (gcloud secrets versions access latest --secret=FIKA_INTERNAL_API_TOKEN --project=fika-os).Trim()
gcloud scheduler jobs create http fika-delivered-in-standing-orders-mon --project=fika-os --location=europe-west4 --schedule="1 12 * * 1" --time-zone="Europe/London" --uri="https://<production Delivered-In host>/api/internal/grab-and-go-standing-orders" --http-method=POST --headers="Content-Type=application/json,x-fika-internal-token=$token" --message-body='{"oplocId":"oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c"}' --attempt-deadline=180s --max-retry-attempts=3
```

Roll-out stages: (1) create the jobs **paused** with the Commerzbank-only body, resume, watch two cycles; (2) only then widen by recreating with body `{}` (all active templates, ≤ 50 per run). Correct London time is guaranteed twice over: the job time zone, and the endpoint itself decides what is due from London wall-clock rules, so an early or mistimed call creates nothing.

When the scheduler is disabled or unavailable: nothing is generated automatically, nothing else changes. The UI shows *Due · not created yet* with *Create now…* for the next two open deliveries until the cut-off, then *Not generated · cut-off passed*. Manual ordering is unaffected.

## 6. Rollback

1. **Stop generation (preferred, instant):** pause the scheduler jobs (`gcloud scheduler jobs pause …`) and/or *Pause generation* on the template. No data change.
2. **Withdraw an unwanted generated order:** cancel it (Orders tab, or *Cancel automatic orders*); it propagates to CPU/Logistics through the normal handoff.
3. **Roll back the app:** `fika rollback delivered-in --prod --execute --owner-approved --reason "…"` using the recorded rollback target. The previous app ignores the new record types and treats generated orders as ordinary orders (extra fields are carried along untouched). Standing documents and indexes are inert and can stay.
4. No migration to reverse.

## 7. Cost and recurring behaviour

| Path | Firestore operations |
|---|---|
| Scheduler run | 1 bounded scan (`recordType`,`status` equality, ≤ limit+1 heads) + per active template ≤ 3 order reads (+1 per historical alias id) ≈ 4 reads. Each created/changed order: ~4 reads and ~3 writes in the guarded transaction (template guard, order, handoff event, outbox delivery claim/settle). |
| Typical month, 10 sites, 3 jobs | ≈ 130 runs × ≈ 45 reads ≈ 6k reads; ≈ 80 order writes ≈ 400 writes. Negligible. |
| Standing tab load | 1 head + ≤ 25 versions + ≤ 10 operations + ≤ 5 order reads + ≤ 5 handoff reads ≈ 46 reads. No polling; no listeners; no per-read audit writes. |
| Audit | Immutable version record per template change; one operation record per manual generation / explicit cancellation. Scheduler runs add no extra audit rows (the order history is the audit). |

## 8. Known risks and open decisions

1. **Activation does not generate.** Per the agreed schedule, activating/amending/resuming creates no order; a date that is already due is created by the next scheduler run or by *Create now…*. If Derek wants activation to create the currently due date automatically, that is a one-line policy change plus its test.
2. **Cancelled dates are final** (existing ordering behaviour) — relevant to UAT step 7.
3. **Release lane** (section 1) may require a staging deployment to satisfy repository policy.
4. Live Hub eligibility/permissions for Commerzbank are confirmed at UAT time, not in this workspace.
5. Production firestore index build time is unknown until deployed; the app degrades gracefully meanwhile.
