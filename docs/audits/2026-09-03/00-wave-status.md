# FIKA OS refactor wave status

Updated: `2026-09-03T04:15:40Z`

## Baseline

- Remote baseline: `origin/codex/uat-allergen-delivered-integration`
- Baseline SHA: `5d68d5d86ff09b2da966d49bae059ba8b9b30862`
- Coordinator branch: `codex/refactor-wave-1-2026-09-03`
- Current coordinator HEAD: `17230c8`
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

- CPU and Delivered-In coordinator typechecks pass.
- Isolated CPU bundle tests: 5/5; CPU route transpilation passed.
- Isolated Delivered-In typecheck/build/targeted tests passed; three pre-existing Grab & Go failures remain.
- Isolated Logistics read-path tests: 10/10.
- Menu Planner tests: 99/99; UX builds passed.
- Full combined verification still pending because the checkout has inconsistent local tool availability/`tsx` IPC restrictions and no Firestore emulator.

## Remaining integration blocker

The CPU route currently persists a daily bundle packet/manifest through a cast to the generic `ReadPackageManifest`, while the Delivered-In reader expects the CPU review package envelope. Wave 3 must make the object encoding, manifest dataset/contract, PDF URL, source hash, and packet payload one explicit shared format before deployment. This is an autonomous engineering fix, not a request to weaken the safety boundary.

## Scope decision

Ad-Hoc, Events Dashboard, and Beverage Innovation are parked and do not block core FIKA OS readiness unless a dependency emerges.
