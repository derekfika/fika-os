# Production consolidation candidate - Phase 2, 2026-10-19

Status: validated local candidate; awaiting Claude final RCoA handoff and Derek approval. No main update, push, deployment, email, scheduler operation or cloud data mutation was performed by this task.

## Provenance and integration

- Canonical baseline: origin/main `f98cd5d999853866c4904f7631d21eb997a256a3` (fetched before work).
- Candidate branch: `codex/production-consolidation-candidate-2026-10-19`.
- Candidate worktree: `C:/Fika/fika-os-consolidation-candidate`, explicitly authorised for Phase 2.
- Validated application-code commit: `508b32b7ceb0fd427d0c356977495bbdc841e996` (the following report/CHANGELOG commit changes documentation only).
- Fast-forwarded this candidate, not main, through `7f0d6233a3ff0b4d7da812d07d2b9bb1ec21454d`.
- Merged Hub activation `11f147748ab9850fedadb12064af057905fa042b`, then its deployed email charge fix `842927bf92689ec18fc5797e104dea6a593db748` and handoff documentation through `ef8bb991527f47d12a10464fe678202a8eed1a03`.
- Merged the separately deployed Hospitality-only RCoA cancellation-notify correction `e842ff9bb70a3f47257d5c232d9667fa74538b2a`. This preserves existing production behaviour; it does not add the unreleased cancellation recovery implementation.
- Merge commits before this documentation commit: `0397b416`, `a0292eec`, `508b32b7`.
- Conflicts: CHANGELOG.md in both Hub email merges. Retained both histories. No application-code, shared-contract or configuration conflict; no application implementation correction was needed.
- Explicitly excluded cancellation recovery `1930822ff0b0be816133fea73ebd12c2cf75d7b1`; it is not an ancestor and its new cancellation outbox module is absent. All other unfinished drafts/feature branches remain excluded.

## Production source/configuration preservation

Live App Hosting readback during preparation proved Hub build `build-2026-10-19-017` READY and serving 100%, source `842927bf92689ec18fc5797e104dea6a593db748`; Hospitality build `build-2026-10-19-004` READY and serving 100%, source `e842ff9bb70a3f47257d5c232d9667fa74538b2a`.

Candidate app directories and shared packages/contracts exactly match the verified source trees for Hub, Hospitality, CPU (`7f0d6233`) and Logistics (`5348f500`). Menu's only additional shared-contract change relative to its deployed `23835b34` is the approved ordered-quantity fulfilment contract. Delivered-In also retains the approved week-header change and shared credentialed-upstream protection from the approved integration lineage. No other feature branches were introduced.

Hub production YAML equals the current verified Hub source. RCoA delivery remains enabled, test mode/verifier disabled, RCoA-only OPLOC allowlist and verified sender retained. Historical UAT exclusions, restricted synthetic-fixture guards, Gmail integration, MIME branding and automatic worker route are preserved. No runtime configuration was changed.

All six production and six staging App Hosting automatic-rollout policies were rechecked: disabled. GitHub Actions workflows: none. Cloud Build triggers in production global and europe-west4: none. Recheck before any authorised main push; this is a point-in-time verification, not a configuration lock or inventory of arbitrary external automation.

## Validation

Optimised production builds and `npm run typecheck`: PASS for Integration Hub, Hospitality Booking, CPU Production, Logistics, Menu Planning and Delivered-In. Build/test processes were pinned to local/demo runtime, with email delivery disabled and no production credential file. No customer artifacts were generated.

| Focused validation | Final result |
| --- | --- |
| Hub Gmail, templates, recipients, rollout/UAT exclusions, outbox | 39/39 PASS |
| Hub booking/routing/group/CPU/fulfilment contracts | 48/48 PASS across unit and explicitly enabled emulator cases |
| Hospitality RCoA, grouped production/lifecycle/presentation, credential guards | 63/63 PASS |
| CPU review, revision/signing/PDF/outbox/security | 95/97 PASS; two established CRLF-sensitive source assertions |
| Actual CPU production-plan POST routes against isolated Firestore | 17/17 PASS |
| Logistics ordered quantities, materialisation, projections/planning | 34/34 PASS |
| Menu credential/archive/invalidation/item identity | 10/10 PASS |
| Delivered-In routing/redirect security, header/withdrawal/release | 13/13 PASS |

Unique focused cases: 319 passed, two known baseline failures. Hub's seven initially gated cases were subsequently exercised with their explicit flags: six routing/amendment cases and the separately gated real group-quote persistence case. None remain unexecuted.

The two CPU failures are in `tests/allergen-signing-lineage.test.ts`: "review edits remain local and row checkpoints are serialized before first signing" and "review session checkpoints only at row boundaries, never resaves between signatures, and supports explicit amendment". The test file and inspected AllergenReviewMatrix.tsx / allergens/page.tsx are unchanged from approved `7f0d6233`, including existing CRLF checkout behaviour. They were not silently waived, relaxed or modified.

Validation setup corrections, not application fixes:
- Existing node_modules copies contained stale installed @fika/server-shared sources. This worktree uses the candidate's own package sources and read-only third-party dependency links, without editing another checkout.
- CPU route tests must run NODE_ENV=development: NODE_ENV=test intentionally selects an in-memory repository, which cannot verify emulator persistence. The corrected invocation passed all 17 real-route tests.
- Hospitality/Logistics initially failed TypeScript package parsing with copied node_modules content; the package-lock-prescribed workspace links plus a fresh local build cache resolved this. Both builds then passed without source/config changes.
- Hospitality's build-generated brand asset/next-env churn was preserved under the validation logs and restored to the approved tracked contents in this candidate. No unrelated generated changes were committed.

Raw logs and exact commands: `C:/Users/derek/AppData/Local/Temp/fika-consolidation-phase2-zv9sczyh/`. `results.json`, `validate.py`, `targeted.py`, `quote-only.py` and individual logs retain the initial attempts and corrected results. npm run typecheck/build were run from each app. Focused tests used `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 <listed test files>`. Emulator projects were demo-fika-os on reserved loopback ports, never an existing agent emulator; only task-owned emulator processes were stopped.

## Preserved dirty drafts and outstanding work

No dirty worktree was edited or blanket-staged.

| Existing worktree | Classification |
| --- | --- |
| `.claude/worktrees/fika-os-pre-uat-commits-065760` | Six dirty entries retained. Earlier email firestore/notifications/guard and RCoA-only template/tests differ from final committed implementation. The earlier guard lacks the final permanent seven-notification exclusions/fixed-fixture hardening; do not restore it over production. Shared branded templates supersede the older separate RCoA template in purpose. Unique draft wording/behaviour remains unreviewed, not discarded. |
| `C:/Fika/fika-os-rcoa-launch-integration` | 27 dirty entries retained. Fifteen cancellation-related files match committed 1930822f after newline normalisation; remaining email/Gmail/config/service/test deltas are mixed drafts requiring owner review. The draft firestore and RCoA-only template are identical to the pre-UAT drafts, while notifications/guards/tests differ between the two. None were imported. |
| `C:/Fika/_scratch/final-2` | Generated quote-brand asset content is newline-equivalent to committed code; next-env remains a separate generated-tooling difference. Preserved untouched. |
| `.claude/worktrees/fika-hospitality-prod-audit-d78a86` | CHANGELOG plus four historical cutover/audit documents retained. These are historical evidence, not current production configuration instructions. |

Keep cancellation recovery and its customer-email reconciliation/release testing separate. Grouped additional-charge editing, remaining portal polish, signed PDF access/full live UAT, paused CPU/Logistics/Menu recovery and the broader Phase 1 outstanding-work register remain outside this consolidation. Claude's committed activation note confirms live submitted/confirmed mail but leaves actual cancellation and standalone amended email observations open; do not represent them as completed UAT.

## Handoff gates and exact next steps

1. Obtain Claude final release handoff: final approved Hub and Hospitality SHAs plus remaining UAT findings. This candidate includes the latest independently verified deployed corrections above, but no direct final handoff has been received.
2. Fetch origin; compare final SHAs against this candidate and verify origin/main still equals the recorded baseline. If new approved changes exist, integrate only them and rerun only affected validation. If main moved, inspect/reconcile deliberately.
3. Confirm existing draft ownership/disposition; preserve unresolved work and keep 1930822f excluded.
4. Obtain Derek approval for the exact final candidate and for updating/pushing main. Do not push this candidate before approval.
5. On the canonical clean main checkout, advance with `git merge --ff-only <approved-exact-candidate-SHA>` only after confirming origin/main is an ancestor. Recheck disabled rollout/CI policies; push main explicitly after authorisation. Never reset or force-push main.
6. Deployment is a separate decision. No backend rollout, production config change, data migration, scheduler activation or email action is authorised by this preparation task.
