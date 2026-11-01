# Dish Library V2 cutover — runbook (issue #151)

Strategy (owner decision, 1 Nov 2026): **archive all of production V1, then activate the validated V2 as the single
active catalogue.** Historical references are preserved through the immutable archive and the #256 resolver. Nothing is
hard-deleted. This runbook describes tooling only; **no production action has been taken or approved**.

Tool: `npx tsx scripts/dish-library-v2/cutover.ts <plan|execute|verify|restore|rehearse>` from `apps/menu-planning`.
Code: `lib/catalogue-cutover/`. Tests: `npx tsx --test lib/catalogue-cutover/*.test.ts`.

## What the cutover does (and does not)

1. **Plan** (read-only). From a store snapshot computes: pre-state manifest (revision, sourceHash, counts), the archive
   set (every V1 dish document including already-archived, raw copy + per-document digest + root digest), the V2 active
   set, successor mappings, reference-integrity result, diff counts, and a `planHash`.
2. **Archive** (first write). Writes `fikaMenuPlanningCatalogueArchives/{cutoverId}/dishes/{id}` (wrapper
   `{id, archivedAt, data: <raw V1 document>}`) and `.../successors/{oldId}` (merges only), reads **every** document
   back and verifies its digest, then creates the sealed immutable root (environment, pre-cutover manifest revision +
   hash + raw manifest, all source ids and counts, raw-record digest, actor/approver/time, backup/rollback identity,
   `referenceManifest` per the #256 contract). `cutoverId` = `dish-library-v2-<first 16 hex of planHash>`.
3. **Activate** in guarded batches (default 100 documents). Each batch is one transaction that re-reads the catalogue
   manifest and requires the exact revision/hash it expects, re-reads each document and requires it to still equal the
   archived raw copy, then writes the documents, bumps the manifest revision (monotonic) with the recomputed
   `sourceHash`, sets `packageState: pending` (the app rebuilds its read package), and advances the journal. Updates to
   survivors (tags/subtypes) go first, then archives, so the active set never shrinks before its replacement exists.
   Any mismatch aborts and leaves `fikaMenuPlanningCatalogueCutovers/{cutoverId}` resumable.
4. **Seal**: only after all batches, the manifest gains `historicalDishReferences` (archiveId, archiveDigest,
   mappingVersion, mappingDigest) so the #256 resolver starts using the archive.
5. **Readback**: every dish document, the manifest revision/hash, the descriptor and the active count are compared with
   the expected state (not with the plan). The journal records the result.

Not done by the tool: package/Storage rebuild (the app's own pending-package flow does that; no package bytes are
touched, so no gzip roundtrip is involved), Hub/CPU/Delivered-In changes, emails, Drive writes, deployment.

## Prerequisites (all must be true before a production run is even requested)

* Merged: #256 resolver (done, `7ca1f0a6`), **and** the UI that shows archived/merged cells (#255/#259/#257) so users see
  the tinted cells after cutover. Cutting over without them is possible but leaves references invisible to planners.
* Owner decisions recorded on #151: EX-004 merge approved; the eight exclusions confirmed (esp. the four Cleanup
  Candidate test dishes, whose dependency audit has never run); nine `menu-item:rolling:*` ids stay active; subtypes for
  the 14 salads lacking one; chef rulings on the 3 exact + 4 fuzzy duplicate clusters (survivors with colliding names
  are listed as plan warnings; the app writer refuses duplicate active names on later edits).
* Issue #181 isolation proven before any **staging** write rehearsal. The emulator needs none of this.
* A tested restore: run `rehearse` and the emulator test (below) from the exact commit to be used.

## Write freeze (required)

The cutover assumes **no other writer touches the catalogue while it runs**. Run it in an out-of-hours window with
Menu Planning catalogue writes paused for planners (no Dish Library edits, imports, tag assignments, rotations/dish
creation, or other migrations) from before step 6 until step 7 passes. The tool detects a concurrent write (manifest
revision/hash, per-document digest) and aborts, but detection is not a substitute for the freeze: an abort mid-run
means a restore. Mid-run guarantee: updates to survivors are applied before any archive, so the active set is never
smaller than the target (353) at any commit boundary (tested); it can briefly contain the not-yet-archived retired
dishes (up to 358). Readers may see the intermediate batches; the historical-reference descriptor is attached only at
the final seal.

## Command sequence

All commands run from `apps/menu-planning`. `$V2` = reviewed staging export `catalogue-dishes.json`; `$REFS` = one
`--references` flag per reference set (always include `migrations/dish-library-v2/references-published-v4-2026-11-02.json`
plus the fresh 9 Nov+ set).

1. **Rehearse locally (no network):**
   `npx tsx scripts/dish-library-v2/cutover.ts rehearse --snapshot-dir <export dir> --v2-records $V2 $REFS`
   Plans, executes against an in-memory Firestore, verifies (82/82 references, nine rolling ids active), restores and
   proves the documents and `sourceHash` equal the starting state.
2. **Emulator drill (real adapter):**
   `firebase emulators:exec --only firestore --project demo-fika-cutover "npx tsx --test lib/catalogue-cutover/emulator.test.ts"`
   (demo project, no credentials).
3. **Fresh read-only production pre-state** (separate, owner-run, governed): export the catalogue, manifest, weeks and
   publications from 9 Nov onward with a GET-only read (as was done for the staging export), **or** run plan with `--project fika-os
   --allow-production` and `FIKA_CUTOVER_ALLOW_REAL_FIRESTORE=1` (authenticated owner; reads the whole catalogue once).
4. **Plan:** `... cutover.ts plan --snapshot-dir <fresh export> --v2-records $V2 $REFS --out plan.json`
   (`plan.json.sha256` is written). Review the plan with the owner. `executable: false` or any blocker is a no-go.
5. **Approval:** the owner states the `planHash` and approver in the issue. That is the only thing `--approval-hash`
   may contain.
6. **Execute** (owner or delegated migration owner, authenticated; deliberately not scripted anywhere):
   `FIKA_CUTOVER_ALLOW_REAL_FIRESTORE=1 ... cutover.ts execute --project fika-os --allow-production --execute --approval-hash <planHash> --approved-by "<name>" --v2-records $V2 $REFS`
   `execute` re-reads the live store, recomputes the plan and refuses unless it equals the approved hash.
7. **Verify:** `... cutover.ts verify --project fika-os --allow-production --cutover-id <id> --v2-records $V2 $REFS --expect-active 353`
   Verify asserts exact seal-revision equality and exact-revision resolver binding **only while the manifest is still at the
   sealed revision/hash**. After any later catalogue edit it skips those two assertions, prints a note, and keeps the
   archive-digest, descriptor-to-archive, count and active-set checks. (The #256 resolver currently pins archive provenance
   to the exact catalogue revision; that is fixed separately, so resolver states after later edits are informational.)
   Run verify before releasing the write freeze.
8. **Smoke** (not automated here): open the 2–6 Nov week and a draft week in Week Planner (original names/slots/portions
   visible), publish-preview, Dish Library active list = 353, picker excludes archived, Hub/CPU/Delivered-In lineage and
   the 6570 portions unchanged.

Staging uses the same commands with `--project fika-os-dev --allow-staging`.

## Go / no-go gates

| Gate | Source | No-go if |
| --- | --- | --- |
| Plan `executable: true` | `plan` | any blocker |
| Plan hash approved | owner | hash differs at execute time |
| Pre-state fresh | step 3 | export older than the approval window, or manifest hash ≠ documents |
| References | `plan` + fresh sets | any reference unresolved; 9 Nov+ not supplied |
| Nine rolling ids | `plan.rollingNine` | any not `active` |
| Rehearsal + restore drill | steps 1–2 | any failure at the commit to be used |
| Archive sealed + readback | `execute` | tool aborts (it will) |
| Verify | step 7 | any failing check |

## Rollback

Immediate rollback target is the sealed archive, not a re-import.

`... cutover.ts restore --project fika-os --allow-production --archive-id <cutoverId>` first **prints a report of
post-cutover changes**, then refuses without `--execute` and shows the computed `restoreHash` (as does `execute`
without `--execute`, for the plan hash). The restore hash is bound to the archive **and to the live manifest
revision + hash**: any catalogue write after the hash was issued invalidates the approval and a new one is needed.
Re-run with `--execute --approval-hash <restoreHash> --approved-by "<name>"`.

* Reproduces every archived raw document and the pre-cutover manifest content; verifies the restored documents hash to
  the archived `sourceHash` before and after; manifest `sourceRevision` stays monotonic (never reused); `packageState`
  is set to pending; `restoredFrom` is recorded; the cutover journal becomes `restored`.
* **Post-cutover changes.** The archive root stores the digest of every document as sealed (`postCutoverDigests`) and the
  sealed V2 documents are kept under `postCutover/`. Restore compares the live catalogue with them and reports:
  documents edited since (with the differing top-level fields), dishes created since, dishes deleted since, and manifest
  drift. If there is any, restore **refuses unless `--accept-post-cutover-changes` is given.**
  With the flag: every edited document is copied to `.../postCutoverChanges/{id}` (`kind: edited`, the overwritten live
  document) before it is overwritten with the archived V1 document; every dish created after the cutover is copied to
  `postCutoverChanges/{id}` (`kind: created`) and then **archived in place** (never deleted, never left in the active
  picker, readable by id). Chosen as the safest option: leaving them active would put unreviewed dishes into the restored
  V1 library, and refusing outright would block an emergency rollback. When such dishes exist the restored `sourceHash`
  is the hash of V1 plus those archived dishes, not the original hash; without them it equals the original exactly.
* Refuses if any archive digest fails. Idempotent; resumable if interrupted (side records are never overwritten). A
  rolled-back cutover cannot be re-run with the same approval; plan again with `--attempt 2` (a new plan hash and id).
* The archive, side records and journals are never deleted.

### Interrupted or aborted `execute`

Re-running the identical command (same approval hash) resumes **only if** the live manifest revision/hash still equals
the journal last written state (or the plan pre-state when no batch ran). If it does not, execute stops, marks the
journal `aborted` and says: *Aborted => run restore --archive-id <id> or re-plan with a new --attempt.* It never loops or
forces. A foreign catalogue write is an operator decision: restore, or re-plan.

## Needs Derek's explicit approval (cannot be implied by "build" or "test")

* Running anything against `fika-os` (read or write), including `--allow-production`.
* The plan hash and the named approver for `execute`; a separate approval for `restore`.
* Running against staging (`--allow-staging`), only after #181.
* The decisions in Prerequisites; deployment of any app change; any migration, Firestore or secret mutation outside
  this tool; emails or Drive side effects (none are performed).

## Open blockers

1. **9 Nov+ weeks and Hub order lines are unchecked.** Only the 2–6 Nov v4 publication (82 ids) is supplied. Read
   draft/future weeks and publications fresh and pass them with `--references`; any unresolved id is a plan blocker.
2. **#181** (staging isolation / email sink) unproven: no staging rehearsal until it is.
3. **Live pre-state not re-read.** Plans so far use exports (staging rev 18; production rev 160 export). The approved
   run must re-read production immediately beforehand; the executor enforces plan-hash equality.
4. **Owner approval of the proposal is not recorded** (see Prerequisites). `executionAllowed: false` in the frozen
   dry-run manifest is intentionally not overridden by this tool: approval is the plan hash plus `--approved-by`.
5. The mappings are minimal: 1 merge. 188 archived ids have no verified successor and remain unresolved (the resolver
   reports them archived/unresolved; names never create a mapping). Adding verified successors needs a reviewed list.
6. Firestore rules/indexes for the new collections are not needed (server-side Admin access only); the app does not yet
   read `cutover` or `restoredFrom` manifest fields (informational).
7. The cutover writes Firestore documents directly (the app writer cannot do an atomic archive+activate). Because the
   app writer rejects edits to dishes whose name collides with another active dish, duplicate active survivor names are a
   **plan blocker** unless listed in `duplicate-name-allowlist.json` (empty; part of the plan hash). The current proposal
   has no collisions (checked on the survivors file and on the V2 records).
8. `npm test` in `apps/menu-planning` runs `tests/*.test.ts` only; these tests are colocated and run with the command
   at the top of this file (CI wiring needs a package.json change outside this lease).
9. **Numeric type fidelity.** Documents are archived and restored through the Node Firestore client. Integers and
   fractional doubles keep their Firestore types (asserted on the emulator via REST integerValue/doubleValue). A
   whole-number value stored as a Firestore *double* is indistinguishable from an integer in the client and is rewritten
   as an integer (verified on the emulator); the digest cannot see this. Dish records are JSON-like and should not depend
   on it; confirm with a typed scan of the fresh read-only export before the run.
