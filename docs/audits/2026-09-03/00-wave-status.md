# FIKA OS refactor wave status

Updated: `2026-09-03T04:59:28Z`

## Baseline

- Remote baseline: `origin/codex/uat-allergen-delivered-integration`
- Baseline SHA: `5d68d5d86ff09b2da966d49bae059ba8b9b30862`
- Coordinator branch: `codex/refactor-wave-1-2026-09-03`
- Current coordinator HEAD: `3bd0015`
- No deployment performed.

## Wave 1 — complete and integrated

| Thread | Commit | Result |
|---|---|---|
| 1 — AuthMod/security | `3b6b616e` → `cb4a9f2` | AuthMod-derived Menu Planning authority, OPLOC-scoped publication reads, fail-closed staging service secrets, Delivered-In feed secret handling. |
| 2 — Hub/CPU handoff | `02125f6` → `76d75ab` | Shared materialisation contract, `publicationId` compatibility, token-gated Hub production read, CPU token forwarding, lineage/correlation tests. |
| 4 — Firestore/Logistics | `08e29bd` → `ce70be8` | Bounded fulfilment/date/site queries, 500-result guard, one range request for planning windows, indexes and read-path tests. |
| 5 — UX/UI | `5297f20` → `9d0fa25` | Hub mobile drawer/labels/environment badge; Menu Planner full-week navigation, allergen legend/responsive guidance, save feedback. |

Additional coordinator test cleanup: `1f3a20d` avoids readonly `NODE_ENV` mutation in a regression test.

## Wave 2 — complete and integrated

| Thread | Commit | Result |
|---|---|---|
| 3A — CPU daily bundle | `a64d547f` → `6478091` | Daily signed OPLOC bundle contract, mandatory master/PDF, multi-sub-item truth, hash binding, publish-last sequencing, tombstone lineage and tests. |
| 3B — Delivered-In boundary | `e667119` → `1a7d9eb` | Raw allergen route retired (410), permission removed, packet-only ordinary reads, maintenance auth, stale/withdrawn blocking and invalidation tests. |

Coordinator compile repair: `17230c8` wires `cpuPackageStore` into the CPU daily release route.

## Verification evidence

- CPU, Delivered-In, and Menu Planning coordinator typechecks pass.
- CPU daily bundle tests: 5/5; Delivered-In bundle/invalidation tests: 9/9.
- Delivered-In boundary/projection review tests: 22/22.
- Logistics focused tests: 29/29 reviewer suite and 10/10 specialist suite.
- Serial CPU, Delivered-In, Logistics, Hub, and Menu Planning builds passed.
- No deployment has been performed; staging UAT and Firestore-read measurement remain required.

## Integration blocker status

The former CPU → Delivered-In envelope mismatch is resolved. CPU and Delivered-In now use the shared gzip packet envelope, daily signed OPLOC bundle dataset, contract identifier, source revision, distinct compressed/raw hashes, and strict validation. Staging UAT must still verify real Drive/PDF identities and end-to-end handoff behaviour.

## Scope decision

Ad-Hoc, Events Dashboard, and Beverage Innovation are parked and do not block core FIKA OS readiness unless a dependency emerges.
