# Production AUTHMOD policy migration plan — 2026-10-17

## Status

**SOL APPROVED AND EXECUTED — VERIFIED.** The plan and analysis below are the approved migration specification. Execution and post-write verification are recorded at the end of this document.

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

After migration, access packages are regenerated from production Firestore using `bootstrapActiveAuthmodAccessPackages()`; the three staging AUTHMOD package manifests were not copied.

## Validation

- `node --test tools/authmod-policy-migration/engine.test.mjs` — 9/9 passed.
- `node --check tools/authmod-policy-migration/cli.mjs` and `engine.mjs` — passed.
- Live CLI dry-run — reproduced the exact approved 120-record analysis hash, generated 117 portable records plus 3 fresh production records, and confirmed the 19/7/0 production baseline.
- Independent saved-body hash recomputation matched the embedded executable plan hash; 120 target paths are unique; no target policy record carries a Firebase UID/provider or email authority subject.
- At planning time no production apply or package rebuild had run; see execution record below.

## Approved execution — 2026-10-17

- SOL-approved executable plan hash: `8c1e5aa1cdbf28ee48af78fb18e30770dc4004777233538b9661e53638de73db`.
- Source-state hash revalidated by the governed CLI: `f1e72baac90d76575325dfbad13a467062596c5d6e169cb4e843edcfbb587cba`.
- Production reference-state hash revalidated by the governed CLI: `15f605e97fd2efca7ddc39850bfa45bea38a8ba1c227e01ecf7c689a0da6864d`.
- The CLI performed one atomic create-only commit: 117 portable policy records, three approved production-native Derek records, and one migration audit receipt. Result: committed; no retry or repair was needed.
- Recursive production Firestore read-back: 2,380 documents across 15 collections, zero missing-parent placeholders. The prior approved bootstrap set remains represented by its 2,259 documents; migration added exactly 121 documents.
- Exact policy counts: 16 active app assignments, 51 active site assignments, 43 active authority grants, 10 active custodian assignments, and one migration receipt. No unexpected AUTHMOD policy collection was found.
- All 19 production identities were read back. Firebase UID/provider bindings: zero. `fullAccess=true`: zero, including the previously reset identities.
- Derek's existing identity `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7` remains active, unbound to a production Firebase UID, and `fullAccess=false`. It has the approved Integration Hub assignment, View grant, and organisation-scoped AUTHMOD/Administer grant. The three deferred CPU allergen-sign/final-approve and Menu Planning publish grants remain excluded.
- The production audit receipt is `authmodAccessAudit/production-authmod-policy-migration-f1e72baac90d76575325`; it records the source/plan hashes, operator, exclusions, approval, and commit timestamp.
- Existing `bootstrapActiveAuthmodAccessPackages()` published packages for all 19 active identities (19/19; zero failures) to the production package bucket. Each downloaded package passed compressed-byte integrity verification and its payload was compared against live production identity, assignments, grants, delegations, custodians, and access-head version. All manifests report `sourceVersion=authmod-security:0`; Derek's package content hash is `70ae3c58b8b6e210651e33ebb4fdddcdfa14a923ef8c44f834605a67facf6e5f`.

| Identity | Package SHA-256 |
|---|---|
| `authid:0015ad37-ea53-48c2-9ba9-98a6b916c12f` | `2186d8428a486fc3cb744d0cd473bc5abc9f9b45a7923aafbde6f77261416677` |
| `authid:10ad9dda-bb54-4916-b607-23ed45e7c352` | `44bf5b799f89cd4fb1ab89c2c77859e576e4e3864aea48d4bb0edf7cd9f399be` |
| `authid:1b54c6c7-fef7-4254-8eb5-35372a6f976a` | `b0b71ffea702074780c604d12d437cc0a8427e20cedccf1a0ce063e4b862b645` |
| `authid:2f928138-4323-4abc-8c6a-8ada1751799b` | `6aae22fb47836c67984e425c4801f457e9c76d5d192ea58b741b7590d072089d` |
| `authid:322c9897-c262-4c7e-ab41-86ceda4a4004` | `2e6d5903cd736cf714cb0950293b1a717ea3d7d9210527ac16a6dcaa806a9011` |
| `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7` | `70ae3c58b8b6e210651e33ebb4fdddcdfa14a923ef8c44f834605a67facf6e5f` |
| `authid:598d22ac-3b60-4f78-a680-432310f7bc79` | `e645fe322279b3f111ba933b8fd9d7f89f454e30eba8e03f364b40f2f5a0102c` |
| `authid:5cbe90c2-247b-4ed2-9331-4dd045f12df3` | `02973e21922db9a91c5309caa9b76b7c34e5db291ea360ed88d4663c6f37209d` |
| `authid:6e580fec-9741-4536-9328-c142480de766` | `c0cd81d5d252f8b6935b2563fa4ae8624b24b5f4284c21bbee4c1b93db8ae1b2` |
| `authid:7a8d1165-7c05-4e60-83e9-9df0f2d4e7b8` | `05b1d86fcf671f09d9c3477786268285b62351640036d5a70a40ebfd839f2411` |
| `authid:7f394423-c9cd-431e-8e21-b714b0d64dff` | `e76c33625a0ee14b57b20a25052a6bd4d97c1ca3173a2142d2353f4070cf111b` |
| `authid:80543c71-3403-49c7-adbb-d95d72477ce9` | `e7dbbfd0344a6b18a318a0a36b52329d6be75412222f248a227ecb29b90d5809` |
| `authid:90918ead-5288-44b6-ac5e-288b891358bf` | `10866ea07ae94344b156eb17f6de65e4cb93dfa1e049f9b3aacc1f3c9c60e352` |
| `authid:b32e8679-ec63-49ae-bad5-64d7b59edea0` | `0aa1b091b3af5f666fda79cd741bc9d800fe9f9bf33c36d4d4f2eda47a715001` |
| `authid:b5888fae-649e-4cbf-aa1c-328eea5abb47` | `ffadde916d568b5407a4e9e2b051455732d4cf4c87b6430895e863175bbb6621` |
| `authid:b99a7dfe-e411-4d30-a2b4-af9d956b7429` | `40395c421d6c5b696ba935a7d64c445a27b8781206c23178c8a351fd718adf70` |
| `authid:bb33ee7c-91df-4042-8906-e1925fd58545` | `a8fd8b01ba6d000876db378844f1b4a3aa7d1bdb786eed9168a98318558e7264` |
| `authid:c03bac1c-71ae-4c04-9667-3e18aff2e296` | `9e55a1f9f5265d292ab58fcf70e16021549b0076057ef58572a7d97020148e16` |
| `authid:cc1a7452-949d-40a3-a745-a3ac088a339a` | `abff4bfeab64b5b6886a3bdd2837b817a0e00e6ffa18be82f3f066a4b8c0ea53` |

- Safety read-back: six application runtime identities remain without `roles/datastore.user`; all three recovery Scheduler jobs remain PAUSED; no mailer/email secret is present. No app deploy, Git push, Firebase UID binding, `fullAccess` grant, or staging change occurred. Production package publication wrote only the 19 derived AUTHMOD packages and their manifests.
