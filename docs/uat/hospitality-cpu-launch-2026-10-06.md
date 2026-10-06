# Hospitality → CPU launch regression — 6 October 2026

Task: FIKA OS Launch War-Room — Hospitality → CPU End-to-End Fix.
Repository: `C:\Fika\fika-os`, branch `main`.
Starting origin/main: `9f716c651b4af3ecf94917d1812aa0cb2633b767`.

The task-specific protection instruction overrides the root changelog rule:
`CHANGELOG.md` and `sites/mnk/booking-platform/01_MenuData.js` must remain
byte-for-byte unchanged and uncommitted. This report records the task instead.

## Baseline staging evidence

Firebase project: `fika-os-dev`. Active builds verified through App Hosting traffic:

| Backend | Active build | Source | State |
| --- | --- | --- | --- |
| fika-hospitality-staging | build-2026-10-05-002 | ff3a6eb10ba46c1871fa98b239d8985c47fc75f0 | READY, 100% |
| fika-cpu-production-staging | build-2026-10-05-001 | b1e6e16fa738cdce588c357813d1549cd5946366 | READY, 100% |
| fika-os-staging | build-2026-10-05-001 | b1e6e16fa738cdce588c357813d1549cd5946366 | READY, 100% |

Original source request: `MNK-20261006115146-EE8A`.
Canonical booking: `booking:mnk:86ee28f023384fde1245816b9b595244`.
OPLOC: `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`.
Service: 13 October 2026, 12:00, 12 guests.
Baseline quote: revision 1, saved to Drive, current/non-stale.
Labour: one chef, three hours, £17.88/hour, multiplier 1.5; £80.46 net.
Total: £223.46 net, £44.69 VAT, £268.15 gross.
Order: `production-order:v1:booking:mnk:86ee28f023384fde1245816b9b595244`,
version 1, draft. Sandwich line: 12 people → 36 pieces, workstream `sandwiches`.

Direct reads of the deterministic booking/order IDs and affected week projection
confirmed the canonical handoff and projection already existed. After selecting
12–16 October and waiting for its bounded load, CPU displayed the original job.
The initial current-week view (5–9 October) correctly excluded it. No routing,
handoff or visibility broadening was needed.

CPU console reproduced React error #418 (text mismatch) on both its default and
friendly staging URLs. Public served HTML contained header date `5 Oct 2026`;
the browser rendered `6 Oct 2026`. The statically generated page evaluated its
clock at build time. This is independent of canonical order visibility.

The original booking was amended through its existing governed UI with a staging
UAT reason. Quote regeneration, PDF saving and replacement CPU handoff completed
without manual reload. Immutable history and supersession were retained.

## Source changes

- Clock-free initial CPU state; UK dates and week selection initialise after
  hydration. No suppression of hydration warnings, auth changes or wider filters.
- UK operational-day selection handles BST midnight and weekend rollover.
- Hospitality production detail displays the configured production quantity and
  unit, alongside the ordered customer quantity.
- Complete quote response timeouts include body reads, not just headers.
  Network failures settle loading state and expose a recoverable error.
- Failed PDF status recording retains the returned booking version before retry.
  This prevents retrying with the version preceding that status mutation.
- Charge-save and amendment commands use the same bounded request handling.
  Existing governed charge fields, validation and stale-quote logic remain intact.
- Quotes select existing app-local site logos using immutable `portalSiteId`.
  Embedded data URIs survive hosted PDF rendering; unknown sites retain FIKA
  branding and their label. No label-based identity join or external asset added.
- The RCoA configuration regression test accepts Windows line endings.

Style Guide compliance: PASS. Existing UI tokens/components are retained. The
self-contained PDF retains its established styling. Dark-lettered artwork has
a white backing; MNK's reversed white artwork stays transparent on the existing
purple masthead. Actual PDF inspection caught and corrected the initial white
backing on MNK before declaring UAT complete.

No authoritative shared contract or persistence schema changed. No new recurring
reads/writes, listeners or polling were added. Cold/warm CPU read shapes retain
the existing actor-scoped package cache and bounded week/date projection reads.
Existing quote/charge domain events, immutable revisions, optimistic version
guards and handoff audit/outbox mechanisms remain authoritative.

## Validation before rollout

- Hospitality `npm test`: 97/97 passed after the CRLF test correction.
- Hospitality and CPU `npm run build`: passed.
- Hospitality and CPU `npm run typecheck -- --incremental false`: passed after
  regeneration of Next.js route types during build.
- CPU affected dashboard/projection/package/presentation regression set: 87/87
  passed, including UK midnight/DST and clock-free initial-state regressions.
- Hub isolated quote/charge/routing/authorization/materialisation contracts:
  27/27 passed.
- Full CPU suite with `NODE_ENV=test`: 273/282 passed; nine baseline failures
  remain in unchanged allergen signing/Drive/outbox tests or their unchanged
  implementations. One expects absent mutable local plans.json. These are not
  claimed green and are outside this quote/dashboard batch.
- An initial sandbox tsx launch failed with `uv_os_get_passwd ENOMEM` before
  executing tests; subsequent escalated runs executed real tests.
- An initial CPU typecheck could not write tsbuildinfo (`EPERM`); rerun disabled
  incremental output. Initial Hospitality typecheck had stale dev/build route
  type disagreement; build regenerated it and the rerun passed.
- Emulator-dependent Hub production-domain integration run was stopped because
  no isolated emulator was available. The attempted fulfilment regression also
  exposed an unchanged delivery-hash expectation failure. Staging UI UAT is
  required to verify the actual Hospitality handoff.

## First exact-SHA rollout and UAT

Both changed apps served 100% traffic from
`184b29f57fb2df5d643ee22a8faab1a8051d724a`, READY, rollout/build
`build-2026-10-06-001`. Hub and all other apps were not deployed.

Fresh source request: `MNK-20261006122750-BFD2`.
Booking: `booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`.
12 guests, 13 October 2026, 12:00, MNK · Launch UAT.

- First quote generated without reload: revision 1, £143 net, £28.60 VAT,
  £171.60 gross, Drive saved. Loading settled and console had no errors.
- Saved a manual equipment charge at £10, then edited and explicitly saved it
  as 2 × £12.50 = £25 net. Old quote became stale and CPU handoff was disabled.
- Regeneration without reload created exactly revision 2: £168 net, £33.60 VAT,
  £201.60 gross. Revision 1 retained its original snapshot and stale flag.
- CPU handoff through the UI completed and retained the current saved quote.
  Booking reached Completed through the existing completion workflow.
- Production Order:
  `production-order:v1:booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`,
  version 1, draft, current quote revision 2, one Sandwich Lunch line,
  12 people → 36 pieces, `sandwiches` workstream.
- Production Requirement, durable `production.order.created` event and
  fulfilment requirement all exist; fulfilment receipt is `processed` and its
  pending requirement carries 36 pieces. The correlation ID points back to the
  Hospitality handoff. Targeted week projection contains the same current order.
- CPU UI displays the UAT order in 12–16 October. Detail visibly displays
  36 pieces to produce and 12 people ordered. Sandwiches scope includes it.
- Public initial CPU HTML contains `Loading date` and `Loading production
  calendar`, with no stale build-date text. Authenticated hard refresh, empty
  current week, populated next week and normal scope navigation produced no new
  React hydration errors.
- Bounded Cloud Run request logs for actual UAT quote, PDF-save, charge-save,
  handoff and production-sync POSTs all returned HTTP 200. Quote commands were
  about 0.5 seconds; PDF/Drive stages about 7.5–8 seconds.
- The connected Drive account cannot fetch the fresh UAT-owned PDF (404).
  Original-booking PDF is accessible: its governed amendment regenerated the
  current quote after deployment and preserved £268.15 commercial values.
  Download/render of that actual PDF exposed reversed MNK artwork on a white
  backing. The focused correction retains a transparent backing for MNK only;
  other site assets and branding identity stay unchanged.
- Final logo-correction Hospitality tests: 97/97; build/typecheck passed.
  A Hospitality-only exact-SHA rollout and final PDF readback follow.

## Final quote inspection and discovered daily-package defect

Hospitality's final logo correction serves 100% traffic from
`03a8249d3639f38c3c87eac3ea24f7b1e14a77f8`, READY, build/rollout
`build-2026-10-06-002`. Original-booking final governed amendment completed;
its actual Drive PDF modified at 12:47:16 UTC was downloaded and rendered.
The one-page quote visibly contains the full MNK International logo, with no
clipping or missing lettering, and retains its £268.15 total.

RCoA and MNK remain available in the governed workspace selector. RCoA selection
opens its own canonical OPLOC and site branding. Reloading MNK retained the UAT
booking's edited charge and saved current quote. CPU retained the UAT order in
Sandwiches scope after reload. No new hydration errors were captured.

A later Day-view load/refresh exposed an additional confirmed defect:
`sync-production-event` and related mutation commands used a route-local daily
rebuild that wrote the projection directly but did not publish the daily read
package. Weekly publication used the canonical materialiser and succeeded, so
the week view worked while the daily package remained unavailable.

Correction: all handoff/mutation daily rebuilds delegate to the existing
monotonic daily materialiser, including package publication. Missing historical
daily packages now recover through a coalesced, single-date canonical rebuild.
Valid empty days publish zero orders; no fake work is created. The integrity
failure branch returns before either day or week recovery and stays fail-closed.

Affected CPU regression set after this correction: 90/90 passed. This includes
historical missing-day recovery, preserved 12-person/36-piece quantities, empty
day, concurrent rebuild coalescing, failed-recovery retry, bounded date scope,
and integrity-failure separation. CPU build and typecheck passed.

Read/write shape: package HIT and warm client manifest validation retain their
existing bounded paths. Only a MISSING daily package triggers the date-scoped
canonical query, direct reads for affected plans, monotonic derived projection
write and package/head publication. Concurrent requests for that date coalesce;
no polling, broad listeners or business audit writes are added for recovery.
Shared DTOs, GCS gzip storage adapter and compressed-byte integrity contracts
are unchanged. Actual CPU Day and empty-day UAT follow the CPU-only rollout.

Production remains untouched. Final rollout/UAT and protection hashes will be
appended after daily-package correction verification.
