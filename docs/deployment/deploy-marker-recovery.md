# Recovering an interrupted deploy operation marker

`fika workspace complete` refuses while a durable operation marker for the workspace exists
in `.git/fika-workflow/workspace-operations/`. `recover-validation` and `recover-dev` cover
only those kinds; releases stay protected. This note covers the one narrow, evidence-based
case for a **deploy** marker: the deploy process died after writing its marker and its
release intent, and a later deploy of the same app and environment has since completed.

This does not replace `fika reconcile`. If the deploy might still be pending or completed, use
`fika reconcile`; this tool refuses in that situation.

## Entry point

`cli.mjs` is not wired yet (follow-up). Until then, run from the **canonical checkout**
(`C:\Fika\fika-os`, authenticated as the repository owner/administrator, exactly like
`recover-dev`), using the merged tool:

```text
node tools/workflow/deploy-marker-recovery.mjs <marker-id> --reason "<verified outcome>"
node tools/workflow/deploy-marker-recovery.mjs <marker-id> --reason "<same reason>" --execute --approve-hash <hash>
```

The first form is a dry-run preview and the default. `recoverDeployOperation` is also
exported from `workspace-admin.mjs`, with injectable `authorize` and `processAlive`.

## When recovery is allowed (all must hold)

1. Repository-administrator authentication (canonical checkout, FIKA OS origin, owner with admin).
2. Marker `kind` is `deploy`, `id` equals the requested id, and its integer `pid` is confirmed
   not alive (checked before and after the ledger evidence).
3. Exact marker id and a reason of at least 8 characters.
4. The marker's workspace, owner and lease id match the registry's lease.
5. Read-only ledger evidence (after `git fetch origin`, git objects only, first-parent history of
   `release/<env>/<app>`): across all app and environment ledgers, **exactly one** `intent` record
   was committed from the marker `startedAt` (to the second) up to 120 seconds later.
6. That intent is **not** completed: no later `deploy` or `rollback` record has the same
   source SHA or release id.
7. A **later completed `deploy`** record for the same app and environment exists, and the ledger
   head is not a newer pending intent. All later records name the same app and environment.
8. No release lock `release-<app>-<env>.lock` and no non-`completed` journal
   `release-<app>-<env>.json` exists for that app and environment. Locks are never broken.

Zero or multiple candidate intents, a different app, a live pid, a completed same-SHA record, a
missing supersession, an unreadable journal or any lock/pending journal all refuse with a precise
message. Use `fika reconcile` for pending release state.

## What it does

* **Preview** (default): prints the marker, lease, evidence (intent, superseding deploy, ledger
  head, record count) and an `approveHash` over marker, lease and that evidence. It changes nothing.
* **Execute** (`--execute --approve-hash`): under the existing `workspaces` lock it recomputes the
  evidence and refuses if the hash differs. It then writes
  `workspace-audit/deploy-recovery-<id>.json` (actor, reason, evidence, ledger SHAs, original marker)
  and **moves** the marker to `workspace-operations-archive/<id>.json` (atomic rename; an existing
  archive is never overwritten). An interrupted execution is resumable: an existing audit is kept
  and the move completes. A replay after success returns the audit with `alreadyApplied: true`.
* It changes **nothing else**: no lease, registry, ledger, journal or lock.

After recovery, the workspace's lease is unchanged; run the normal `workspace complete`.

## Preview shape

```json
{
  "schema": "fika.deploy-marker-recovery-preview.v1",
  "dryRun": true,
  "actor": { "login": "...", "repository": "derekfika/fika-os", "administrator": true },
  "reason": "...",
  "marker": { "id": "...", "kind": "deploy", "name": "...", "owner": "...", "leaseId": "...", "pid": 0, "startedAt": "..." },
  "lease": { "workspace": "...", "owner": "...", "leaseId": "...", "state": "..." },
  "evidence": {
    "app": "hub", "environment": "staging", "ledgerBranch": "release/staging/hub", "windowSeconds": 120,
    "intent": { "commit": "...", "committedAt": "...", "kind": "intent", "sourceSha": "..." },
    "supersedingDeploy": { "commit": "...", "committedAt": "...", "kind": "deploy", "sourceSha": "..." },
    "ledgerHead": { "commit": "...", "kind": "deploy" },
    "recordsAfterIntent": 0
  },
  "approveHash": "<64 hex>",
  "action": "...",
  "execute": "node tools/workflow/deploy-marker-recovery.mjs <id> --reason \"<reason>\" --execute --approve-hash <hash>"
}
```

## Follow-up

Wire `fika workspace recover-deploy` in `tools/workflow/cli.mjs` once the lease that owns that file
is released. The standalone entrypoint and the exported function stay compatible.
