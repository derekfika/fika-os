# Recovering an interrupted deploy operation marker

`fika workspace complete` refuses while a durable operation marker for the workspace exists
in `.git/fika-workflow/workspace-operations/`. `recover-validation` and `recover-dev` cover
only those kinds; releases stay protected. This note covers the one narrow, evidence-based
case for a **deploy** marker: the deploy process died after writing its marker, and every
release intent it could have created has since reached a terminal ledger record.

This does not replace `fika reconcile`. If any release might still be pending, use
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

## Why the rules are strict

A deploy marker records only workspace, owner, lease, pid and start time: no app, environment or
release id. It can therefore only be matched to the release ledgers by time. To make that safe, the
tool requires the whole release system to be quiescent and every intent in the window to be provably
finished. (Follow-up: future deploy markers should record app, environment and releaseId so matching
need not rely on time.)

## When recovery is allowed (all must hold)

1. Repository-administrator authentication (canonical checkout, FIKA OS origin, owner with admin).
2. Marker `kind` is `deploy`, `id` equals the requested id, and its integer `pid` is confirmed
   not alive (checked before and after the ledger evidence).
3. Exact marker id and a reason of at least 8 characters.
4. The marker's workspace, owner and lease id match the registry's lease.
5. No `release-*.lock` file exists, and no `release-*.json` journal is non-completed or unreadable,
   for **any** app or environment. Locks are never broken.
6. Read-only ledger evidence (after `git fetch origin`, git objects only, first-parent history of every
   `release/<env>/<app>` ledger that exists):
   * no ledger head, for any app and either environment, is an `intent`;
   * at least one `intent` record was committed from the marker `startedAt` (to the second) up to
     120 seconds later, on any ledger;
   * **every** such intent has a releaseId, and a later record on its own ledger with the **same
     releaseId** and a terminal kind (`deploy`, `rollback` or `abandoned`). The terminal record may be
     hours later (an intent completed by `--resume` still counts). All later records on that ledger
     must name the same app and environment.

Zero candidate intents, an intent without a terminal record of the same releaseId, a head intent
anywhere, a live pid, a lock or a non-completed journal refuse with a precise message. Use
`fika reconcile` for pending release state.

## What it does

* **Preview** (default): prints the marker, lease, evidence (each intent with its terminal record, and
  each ledger head) and an `approveHash` over the marker, lease and every intent/terminal pair. It
  changes nothing.
* **Execute** (`--execute --approve-hash`): under the existing `workspaces` lock it recomputes the
  evidence and refuses if the hash differs. It then writes
  `workspace-audit/deploy-recovery-<id>.json` (actor, reason, evidence, intent and terminal ledger SHAs,
  original marker), fsyncs it, and only then **moves** the marker to
  `workspace-operations-archive/<id>.json` (atomic rename; an existing archive is never overwritten).
  An interrupted execution is resumable: the original audit event is kept, a `resumes` entry (time,
  actor, reason, approveHash, evidence) is appended, and the move completes. A replay after success
  returns the audit with `alreadyApplied: true`.
* It changes **nothing else**: no lease, registry, ledger, journal or lock.

After recovery, the workspace's lease is unchanged; run the normal `workspace complete`.

## Preview shape

```json
{
  "schema": "fika.deploy-marker-recovery-preview.v2",
  "dryRun": true,
  "actor": { "login": "...", "repository": "derekfika/fika-os", "administrator": true },
  "reason": "...",
  "marker": { "id": "...", "kind": "deploy", "name": "...", "owner": "...", "leaseId": "...", "pid": 0, "startedAt": "..." },
  "lease": { "workspace": "...", "owner": "...", "leaseId": "...", "state": "..." },
  "evidence": {
    "windowSeconds": 120,
    "intents": [
      {
        "ledgerBranch": "release/staging/hub", "app": "hub", "environment": "staging",
        "intent":   { "commit": "...", "committedAt": "...", "kind": "intent", "sourceSha": "...", "releaseId": "..." },
        "terminal": { "commit": "...", "committedAt": "...", "kind": "deploy", "sourceSha": "...", "releaseId": "..." }
      }
    ],
    "ledgerHeads": [ { "ledgerBranch": "release/staging/hub", "kind": "deploy", "commit": "..." } ]
  },
  "approveHash": "<64 hex>",
  "action": "...",
  "execute": "node tools/workflow/deploy-marker-recovery.mjs <id> --reason \"<reason>\" --execute --approve-hash <hash>"
}
```

## Follow-up

* Wire `fika workspace recover-deploy` in `tools/workflow/cli.mjs` once the lease that owns that file
  is released. The standalone entrypoint and the exported function stay compatible.
* Record app, environment and releaseId in future deploy markers.
