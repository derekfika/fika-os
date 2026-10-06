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
self-contained PDF retains its established styling; the white site-logo backing
is limited to approved brand artwork so its existing colours remain legible.

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

Deployment/UAT: pending at the source commit; final evidence will be appended
after exact-SHA rollouts and browser verification.
