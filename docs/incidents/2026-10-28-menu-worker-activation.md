# Menu publication recovery activation — incident #111

Starting main: `1deb7dc87d98e9d60cdca43ecc95aa99b51f30ab`.

## Authority and exact operational change

The owner explicitly approved turning on the production Menu delivery worker to process the published weeks commencing 26 October and 2 November and future publications: “Yeah of course”, in reply to the scoped activation question. On 2026-10-28 at 20:59:10Z, resumed only `projects/fika-os/locations/europe-west4/jobs/fika-menu-publication-outbox-recovery`, then submitted one immediate run. Normal every-minute Europe/London scheduling remains in effect; the batch limit remains 25.

The first endpoint run returned HTTP 200 after 60.594 seconds, but Scheduler's 60-second attempt deadline had expired and recorded 504/DEADLINE_EXCEEDED. At 21:01:16Z, aligned only that job's attempt deadline to 300 seconds, matching both the existing route `maxDuration=300` and the serving Cloud Run request timeout of 300 seconds. This avoids an unnecessary retry of successfully processing batches. The endpoint, credentials, schedule, batch size and retry configuration remain unchanged. No app deployment, IAM change, schema migration, publication rewrite or direct order fabrication occurred.

CPU and Logistics recovery schedulers remain PAUSED. Hub's existing email scheduler remains ENABLED. No other job was changed. The same governed publication/materialisation/idempotency paths performed all operational writes; no synthetic production fixture or local actor was introduced by this task.

## Verification

At 21:02:53Z the bounded read-only inspection verified:

| Publication week | Total historical/current events delivered | Pending/failed | Canonical orders | Orders present in CPU week projection | Delivered-In day/site records |
|---|---:|---:|---:|---:|---:|
| 26 October | 42 | 0 | 16 | 16 | 23 across 5 sites |
| 2 November | 28 | 0 | 23 | 23 | 23 across 7 sites |

The 50 previously outstanding events are delivered. Historical October order identities were retained; the order count remains 16, rather than creating duplicate orders on replay. All November orders remain version 1.

For November, verified every production event against its canonical order and CPU week projection: 23 orders, 242 allocated lines, 6,613 portions. Canonical dish/source-line IDs, service dates, destination scope, source publication day/version/hash, quantities, units and full allergen snapshots match. No comparison errors. Delivered-In's 23 allocated date/site index entries are available/current and match the publication day/version/hash lineage. Allergen review/signing remains CPU authority; delivered menu records do not assert that unsigned safety evidence is signed or clear.

Scheduler subsequently recorded HTTP 200 completions at 21:01:27Z, 21:02:05Z and 21:03:09Z. Live readback at 21:03Z: Menu job ENABLED, deadline 300s, successful status. These demonstrate recurring runs after backlog processing, not merely a submitted activation. Operational evidence is retained outside source at `C:/Fika/_scratch/menu-p0-111-evidence/worker-activation-*.json` and `worker-final-lineage.json`.

## Runtime provenance, rollback and cost

No new application build was deployed. Menu remains source `39f642d190513b8dca612c80635b8f262b0f7f10`, build `build-2026-10-28-001`, integrated by #112. Its exact-source CI, isolated Firestore regression, full Menu suite/typecheck/build and technical staging evidence were verified during the hotfix. The verified prior release remains source `49328c8f69019ac250e3616cf1d0dc4c723acc47`, build `build-2026-10-27-001`.

Operational containment is to pause this Menu job; that prevents future processing but does not undo delivered orders or immutable publication evidence. The original attempt deadline was 60s. Rollback must not delete operational orders or reverse evidence retrospectively.

The existing worker now runs once a minute: up to 25 eligible event claims/consumer attempts per invocation plus existing indexed queue/cursor work when idle. No new polling, listeners or audit model was introduced. Scheduler's normal control-plane audit and existing event delivery records preserve activation/delivery evidence. Enabling CPU/Logistics recovery, new alerting or rotating credentials remains separate work; this activation did not silently include those changes.

## Validation and result

Diagnostic script syntax and repeated bounded production read-only checks passed. Quantity/allergen/lineage comparisons returned zero errors. `fika validate` passed all 80 isolated workflow tests; `git diff --check` passed. No application source changed, so no new application build/typecheck was required.

The owner confirmed real publication succeeded, and its CPU/Delivered-In handoff is now verified. Incident #111 was closed as completed at 21:04:54Z; final evidence is in https://github.com/derekfika/fika-os/issues/111#issuecomment-6480657597. Future release readiness must check the actual worker state and pending-event age in addition to application deployment health.
