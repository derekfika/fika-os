# Week Planner performance and cache repair — #277

Complexity: High. Recommended model: Sol. Reason: identity-scoped derived storage,
copy/publication safety, rendering cache invalidation and production release risk.

Starting incident source: `3f07867f2ac0835a7f5c22b95344c370e0c85408`, production
Menu build `build-2026-11-02-002`. The provider slice is merged PR #278 at
`37a66537d7b2349faeea8019dfc01fae34eef216`. This dependent slice starts there.

## Findings and implementation

- The two cache openers requested different versions of one IndexedDB database.
  Both now call `openMenuCacheDatabase`, with schema v3 and one upgrade routine.
  Fresh/v2/v3 behaviour is independent of opener order. Only the three known
  **derived-cache** stores undergo the established pre-v3 invalidation; existing
  v3 records and unrelated stores are not cleared. No browser/site data deletion.
  Blocked opens/timeouts fail safely with a short cooldown and non-sensitive
  diagnostics; late connections are closed and abandoned upgrades aborted.
- Catalogue reads still validate count, unique IDs, schema and manifest/namespace.
  An unknown identity no longer searches another identity's most recent cache.
  Week cache identity/version fencing and #275 auth/error/retry behaviour remain.
- The grid previously enumerated every target for every occupied cell during each
  parent render. Derived cell/canonical/empty-target indexes now calculate render
  availability once per immutable snapshot/dish list. Actual Copy and drag/drop
  retain `assessDishCopyTarget` and existing versioned server commands. Conflicts,
  populated/allergen-bearing cells, category mismatch and published days stay closed.
- Picker text lives inside the picker; a parent ref preserves Create/Edit cancel
  semantics and a per-cell key resets a new selection. A grid revision explicitly
  covers every grid-visible input and command callback; modal/toolbar changes can
  reuse it. Future grid state must be included in those revision dependencies.
- Spelling findings/counts reuse memoized results. A bounded word cache belongs to
  one loaded dictionary instance, shares correct/suggest work across grid/panel,
  returns independent arrays and is replaced with the dictionary. Ignore/Add still
  run through existing lists; spelling and V2 notices have not been disabled.
- Picker adopts #278's identity-scoped, 60-second, memory-only tag request sharing.
  Editor mutation/conflict invalidation and minimum-version fences are in #278.
  Backend SDK-client reuse does not cache authoritative registry contents. See
  [the provider report](menu-tag-performance-277.md).

## Controlled browser comparison

Loopback production builds, Chromium, same fixture/browser and 4× CPU throttling:
108 filled cells, 500 canonical synthetic dishes distributed across real categories,
26 actual Hunspell findings, 70 V2 Reclassified notices, real verified dictionary.
All operational API responses were synthetic; no production data was changed.
The baseline used the deployed Week Planner/cache source. The tag-provider editor
was inherited but its shared cache was not used by the old baseline picker.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Native key-event to paint, median of ten | 341 ms | 50 ms |
| Worst of ten keys | 574 ms | 163 ms |
| First picker click to paint | 901 ms | 311 ms |
| Second picker click to paint | 382 ms | 233 ms |
| Cold fixture interactive (includes dictionary) | 4,451 ms | 2,866 ms |
| Warm fixture interactive | 3,076 ms | 2,604 ms |
| Tag GETs: picker reopen + editor/cancel | 4 | 1 |
| Full catalogue GET on reload | 1 | 0 |
| API requests during ten typed characters | 0 | 0 |
| Operational POSTs in performance fixture | 0 | 0 |

The fixture also switches to the next week and back, checks reference disclosure
state, spelling panel controls and editor-cancel query preservation. Native event
timestamps/two animation frames distinguish input response from automation roundtrip.
Long tasks, screenshots, metrics and a Chrome CPU profile are retained in local
artifacts. These are controlled measurements, not promised production timings.

One pure 108-entry comparison removed 15,204 repeated entry scans, with indexed
render derivation measured at about 0.53 ms versus 93 ms in an isolated run. Timing
is diagnostic; regression tests assert equivalent eligibility and absence of those
repeated scans, not a machine-dependent unit-test speed ratio.

## Validation and baseline failures

- Full Menu suite with `MENU_CACHE_BROWSER_TEST=1`: **480 passed, one existing
  emulator skip, zero failed**. Browser storage matrix covers fresh/v2/v3, both
  opener orders, retained v3 records, identity isolation, warm hits and blocked tabs.
- Normal CI does not assume installed Chromium: the storage browser test is explicit
  opt-in; the common-schema unit test always runs. Exact-source CI is recorded on PR.
- Menu typecheck and production build passed. No shared-package or downstream
  Production Order schema changed.
- **16 relevant browser tests passed.** Full existing E2E run also reported three
  failures; all three were separately reproduced with the deployed planner/cache
  source: two tests mark the fixture week published but expect copy/drag writes;
  the third expects a ≥15px modal gutter while current CSS yields 10px. Published
  immutability was not relaxed and unrelated modal CSS/tests were not rewritten.
- Existing store tests write a synthetic tracked local catalogue fixture. Those
  isolated-worktree changes were preserved in scratch and restored before commit;
  no runtime data is included. An initial test-contract failure requiring literal
  DB v2 was corrected to assert the shared schema rather than preserve the defect.

## Backend timing and operational gates

Bounded Cloud Run log samples after the #275 release show successful tag GET server
durations **304–414 ms**, and successful week GETs **1.066–1.915 s**. These are request
durations, not keypress costs. Earlier anonymous staging probes returned401 at the
authentication boundary and cannot measure registry/Firestore latency. Do not infer
that SDK construction explains the whole duration. #278 adds `Server-Timing` plus
opt-in setup/doc-get diagnostics for authenticated staging observations.

No new polling/listeners or read-time Firestore audit writes. Warm catalogue and
modal reuse reduce redundant reads; explicit mutations still use server authority.
Weekly Hub/access/service-arrangement/reference/publication latency remains a separate
measurement path; no claim that this patch eliminates all backend latency.

Staging must serve the validated candidate/dependency tree, with owner realistic-week
UAT before a separate Menu-only production instruction. Keep #277 open until that
operational acceptance. Preserve #275's working production source for rollback.
Source integration/staging release evidence is appended to #277 and the governed
ledger; this report does not claim an unverified deployment or authenticated UAT.

Local evidence under `C:/Fika/_scratch/`:
`menu-277-hunspell-baseline-perf.log`, `menu-277-pinned-e2e.log`,
`menu-277-pinned-e2e/` (CPU profile, metrics and screenshot),
`menu-277-baseline-regressions.log`, `menu-277-grid-memo-tests.log`,
`menu-277-last-typecheck.log`, `menu-277-pinned-build.log`.

Style Guide compliance: PASS for changed surfaces; existing semantic styles and
controls retained. The inherited narrow-modal geometry failure above is not new.
