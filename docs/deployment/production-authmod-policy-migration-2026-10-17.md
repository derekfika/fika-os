# Production AUTHMOD policy migration plan — 2026-10-17

## Status

**READY FOR FINAL SOL AUTHMOD MIGRATION APPROVAL — NOT APPLIED.** This record describes a read-only review of live staging policy and a locally saved, hash-bound production migration plan. It does not authorize execution. No production Firestore or GCS writes, deployment, Git push, application-writer restoration, email enablement, or recovery-job activation occurred.

## Live analysis and executable plan

- Source: `fika-os-dev`; destination: `fika-os`.
- Reconstructed the reviewed candidate from the four policy collections: 15 app assignments, 51 site assignments, 44 authority grants, and 10 custodian assignments (120 total).
- The five reviewed staging/UAT records remain excluded by the approved selector. The original candidate body reproduced analysis-only hash `05a47e105323a0bc081d2f625d3725a17a9d2063eb9a03db84913097a834d51e`.
- Excluded the three approved Derek special grants: CPU `production.allergen-sign/Approve`, CPU `production.allergen-final-approve/Approve`, and Menu Planning `menu.publish/Publish`.
- The resulting portable policy is 117 records: 15 app assignments, 51 site assignments, 41 authority grants, and 10 custodian assignments.
- Production read-back at planning time: 19 identities, 7 applications, zero policy documents. Every production identity had `fullAccess=false`; Derek's existing person identity was active and had no Firebase UID/provider binding.
- Source policy state hash: `f1e72baac90d76575325dfbad13a467062596c5d6e169cb4e843edcfbb587cba`.
- Production identity/application/canonical reference state hash: `15f605e97fd2efca7ddc39850bfa45bea38a8ba1c227e01ecf7c689a0da6864d`.
- Complete executable migration plan hash: `8c1e5aa1cdbf28ee48af78fb18e30770dc4004777233538b9661e53638de73db`.
- The saved exact plan body is at `%LOCALAPPDATA%\FIKA\authmod-production-migration\approved-plan-20261017-final-v5.json` (user-local and not tracked by Git). Its embedded hash recomputes from the complete canonical body. It contains the 117 portable records, all exclusions, the three new production records, source identities, target baseline, audit receipt specification, analysis time/effectivity guard, and deferred package-rebuild step.

## Derek's production enrollment

Three new production-native records are included, each using the `production-authmod-v1` deterministic ID namespace rather than reusing the staging-alpha document IDs:

- `authmodAppAssignments/production-authmod-v1:app-assignment:authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7:integration-hub`
- `authmodAuthorityGrants/production-authmod-v1:grant:authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7:integration-hub:View`
- `authmodAuthorityGrants/production-authmod-v1:authority:interactive:authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7:integration-hub:authmod:Administer:organisation`

The Hub View resource is taken from the current production application definition. The Administer grant uses the approved reason: **“Initial production AUTHMOD administrator — explicitly approved for production cutover”**. Record timestamps are bound as an apply-time operation, not frozen at plan-generation time. The migration does not set or copy a Firebase UID. Later verified production Google sign-in must bind Derek's production UID through the existing governed identity flow.

Expected result: 120 production policy documents plus one production-native migration audit receipt. The receipt captures the approving identity, actual operator email bound into the plan, source project/selector/hashes, 117 portable count, three explicitly deferred grants, three new Derek paths, commit timestamp, and executable migration hash. Staging audit rows are not copied.

## Guardrails and package follow-up

The tool defaults to dry-run. Apply requires `--apply`, an exact CLI `--plan-hash`, the same `FIKA_AUTHMOD_PRODUCTION_MIGRATION_APPROVAL_HASH`, `FIKA_RUNTIME_MODE=production`, the operator recorded in the plan, exact source and production-reference state, and the baseline of 19 identities / 7 applications / zero policy documents. It also rejects any approved policy record that expires before apply. It uses one atomic Firestore commit with `exists=false` preconditions. An exact committed retry returns a no-op only when both policy records and the complete audit receipt match; partial, mismatched, or unexpected existing policy fails closed. It rechecks source/reference drift immediately before commit and verifies the resulting policy document set, hashes, and audit receipt.

After a separately approved successful migration, regenerate access packages from production Firestore using `bootstrapActiveAuthmodAccessPackages()`; do not copy the three staging AUTHMOD package manifests. This step is specified in the plan but is not part of this migration and has not run.

## Validation

- `node --test tools/authmod-policy-migration/engine.test.mjs` — 9/9 passed.
- `node --check tools/authmod-policy-migration/cli.mjs` and `engine.mjs` — passed.
- Live CLI dry-run — reproduced the exact approved 120-record analysis hash, generated 117 portable records plus 3 fresh production records, and confirmed the 19/7/0 production baseline.
- Independent saved-body hash recomputation matched the embedded executable plan hash; 120 target paths are unique; no target policy record carries a Firebase UID/provider or email authority subject.
- No production apply, package rebuild, deployment or push was run.
