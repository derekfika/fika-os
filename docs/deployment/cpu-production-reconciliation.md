# CPU completed-rollout adoption — issue #272

Complexity: High. Recommended model: Sol. Reason: production release provenance,
concurrent release protection and recovery lineage.

Use only when a legitimate completed CPU production rollout is serving but the
append-only release ledger still records an older completed source, with no pending
intent. This is an explicit recovery operation, never a rollout or a fabricated
deployment history. Existing pending-intent recovery remains unchanged.

The existing governed CLI accepts:

```powershell
node tools/workflow/cli.mjs reconcile cpu --prod --resolution adopt-completed --sha 22e2b5b672c8322137ded2d088d3c2bc2e89061c --rollout build-2026-11-02-002
```

Dry-run is read-only. Add `--execute` to record the verified serving baseline. Use `--reason` to add an optional note. Routine deploys can adopt independently verified serving state directly through the [operator workflow](workflow.md).

Execution requires clean, integrated tooling with exact-source merge-gate CI;
authenticated repository-write authority; a prior verified non-pending ledger;
no pending/unknown/changed local CPU release journal; exact merged-main PR and CI
provenance for the serving source; and ancestry preserving the previous release.
Two matching authoritative observations verify project/backend/repository/root,
READY source/build, SUCCEEDED exact rollout, single 100% serving traffic, disabled
automatic rollouts and no competing target traffic. Paginated build/rollout/operation
discovery rejects subsequent releases, active/unknown outcomes, contradictory direct
reads and ambiguous identities. The non-destructive HTTP probe must pass.

An immutable local evidence archive (excluding build environment configuration) is
written before an append-only compare-and-swap ledger update. The new `baseline`
record identifies `completed-rollout-adoption`, exact build/rollout, authorization,
source provenance, evidence hash and previous-good record. It explicitly does not
assert historical deployment authorization. The prior ledger remains the first
parent and rollback evidence; no existing record or recovery journal is rewritten.
A readback mismatch fails visibly. An interrupted append must be inspected before
retrying; never create a fake intent or manually edit release branches.

## Observed incident / next release boundary

On 2 November 2026, read-only checks confirmed production build 002 serving
`22e2b5b6` at 100%, with automatic rollouts disabled. The ledger still recorded
`dc77dce5` / build 001. Source 22e2b5b6 is merged PR #267 with successful exact-source
merge-gate; its CPU/shared/package tree has no changes from dc77dce5.

The latest fetched main is `585f5411`, incorporating #271's actual row-level No Key
and conflict-state repair. The staging ledger now records build 003 at that SHA;
the older #272 candidate `218f92ad` must not be treated as the current fix. For current software release eligibility and target verification, follow the [operator guide](workflow.md).

No production data, plans, allergens, signing state, workers or legacy platforms
are modified. No recurring job or Firestore reads/writes are introduced; discovery
is a deliberate operator-only action.
