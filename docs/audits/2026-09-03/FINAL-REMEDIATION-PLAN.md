# FIKA OS refactor — current remediation plan

## Timestamps

- Forensic audit start: `2026-09-02T22:41:46Z`
- Wave-status update: `2026-09-03T04:15:40Z`
- Current audit/refactor state: Wave 3 integration complete; staging UAT pending

## Current disposition

**Staging/UAT required before deployment.** The principal audit findings and the CPU daily packet/Delivered-In integration fixes are integrated on `codex/refactor-wave-1-2026-09-03` at `3bd0015`. No deployment has been performed.

## Highest-risk completed fixes

1. Menu Planning mutation authority now derives from AuthMod rather than unconditional `canManage`.
2. Menu Planning publication/snapshot reads are OPLOC-scoped.
3. Staging/preview internal service tokens fail closed; only explicit local mode may fail open.
4. Menu Planning → Hub → CPU materialisation contracts are aligned and CPU forwards service authentication.
5. Logistics/fulfilment normal reads are bounded by indexed date/site/status predicates.
6. Hub mobile navigation/environment identification and Menu Planner full-week navigation have been improved.
7. CPU now has a daily signed OPLOC bundle contract with master sheet, filtered PDF, minimised packet, source hash, signatures, and publish-last/tombstone semantics.
8. Delivered-In no longer offers a manager-facing allergen checker route and ordinary reads are packet-only with stale/withdrawn blocking.

## Wave 3 gates — complete

- CPU daily route now emits a typed shared producer/consumer envelope with matching compression/hash semantics.
- PDF URL/file identity, packet source hash, bundle ID, service date, and OPLOC scope are bound and validated in code/tests.
- Canonical reconstruction remains behind explicitly authenticated maintenance/reconciliation.
- Core typechecks, focused tests, and serial builds pass; no Firestore emulator was required for these deterministic checks.
- Deployment remains gated on staging URLs/cookies and real-device UAT.

## Required UAT acceptance tests

- Publish a Menu Planning week and observe canonical Hub order, CPU projection, fulfilment, Logistics, and Delivered-In packet consumption.
- Withdraw and amend one day; prove the old Delivered-In packet/PDF cannot display while immutable audit bytes remain retained.
- Generate multiple OPLOC/day bundles; verify each filtered PDF contains only its OPLOC’s portioned dishes.
- Remove/deny `/api/delivered-in/allergens`; verify 410/permission absence.
- Exercise missing staging secrets, cross-site publication IDs, reviewer permissions, and Grab & Go handoff failure/retry.
- Measure Firestore reads for Hub, Menu Planning, CPU, Logistics, and Delivered-In by route/query family.

## Governance decision

Specifications remain authoritative for food-safety ownership, business meaning, access control, and accepted architecture. Update current-state documentation to record verified implementation advances; do not rewrite specifications to excuse unsafe code. CPU remains the allergen authority. Delivered-In receives only signed PDF references and minimised packets. Ad-Hoc, Events, and Beverage remain parked.
