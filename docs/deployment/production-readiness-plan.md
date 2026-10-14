# Production readiness and execution plan (2026-10-14)

Status: **infrastructure preparation partly done; NO migrated data written; NO app deployed; nothing merged to main.**

## Approved decisions applied
1. Dry run approved. 2. Six historical weeks (31 Aug, 7/14/21 Sep, 5/12 Oct) migrate with all publication state stripped; the 19 Oct draft week does not. 3. HR/BrightHR/staffing records are not migrated. 4. AUTHMOD identity/grant/assignment documents are not copied; only the application registry migrates; access is bootstrapped from production Firebase Auth by email.

## Revised migration counts (dry run v2; production is empty and readable, so every document is a create)
- **MIGRATE 2365** = 960 root documents + 147 Menu Planning week days + 1258 day entries. This is 497 more than the first dry run (1,868): the six extra weeks are 6 week documents, 42 days and 449 entries.
- REVIEW 453 root documents (post-launch: Product Category 113, Site 18, brochure candidates 43, 34 dev-modelled operational config records, and their revisions/audit).
- DO NOT MIGRATE 8284 root documents. Writes to transactional/derived/outbox collections: 0.
- The six historical weeks carry transform `stripPublicationState`: status published becomes imported, every dayStatuses value becomes draft, the `menu-week-published` audit entry is removed and a migration audit entry appended; IDs and versions are preserved. No publication, snapshot, outbox, event or archive document is created.

## A. Production project (done / pending)
| Item | State |
|---|---|
| Firestore API + database `(default)` europe-west4, native | **DONE** (settings match staging: pessimistic concurrency, delete protection OFF, PITR OFF) |
| Drive, Slides, Calendar, Cloud Scheduler APIs | **DONE** |
| 23 composite indexes (`deploy/production/firestore.indexes.json`) | **DEPLOYED, building** (22 repo indexes + 1 staging-only CPU change-stack index that no repo file defined) |
| Gmail API | not enabled (only needed when customer email delivery is enabled) |
| Storage bucket `fika-os-prod-read-packages-europe-west4` | **MISSING**: production has no bucket. Create EUROPE-WEST4, uniform access, public access prevention enforced, 7-day soft delete (as staging); grant the App Hosting compute service account object admin on it |
| IAM | production compute SA lacks the staging extras (logging/monitoring viewer for Usage Observatory); not launch-blocking |
| Failed CPU rollouts | **Diagnosed**: the build resolves secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` in `fika-os`, which does not exist (`fah/misconfigured-secret`). The default `apphosting.yaml` is the STAGING contract (`FIREBASE_PROJECT_ID: fika-os-dev`), so a rollout that found its secrets would have pointed production at the staging database |
| Google sign-in | **NOT configured**: Identity Platform returns CONFIGURATION_NOT_FOUND. Manual console steps below |
| Session cookie | name `fika_os_session` is hard-coded and the domain is `.fikacatering.com` for staging AND production: signing in to one environment overwrites the other's cookie in the same browser. Needs a small code change (per-environment cookie name) or acceptance; decision requested |

Manual sign-in steps (Firebase console, project fika-os): Authentication, Get started, enable Google (support email), authorised domains: os, cpu, hospitality, logistics, menuplanner, delivered-in .fikacatering.com. The production web app IDs already exist on the backends.

## B. Production App Hosting config (branch `release/production-candidate-2-config`)
Per-app `apphosting.production.yaml` (project `fika-os`, runtime mode `production`, production domains including menuplanner.fikacatering.com, bucket `fika-os-prod-read-packages-europe-west4`, customer email delivery `"false"`, BrightHR/Square fixture; the UAT email recipients and the mailer secret are NOT carried). `node tools/migration/check-production-config.mjs` fails while any staging reference or REPLACE_ME_* remains; currently 5 placeholders: CPU Drive owner (CPU + Hospitality), PDF renderer URL (CPU + Hospitality), RCoA Drive owner. Backend actions at deploy time: set each backend's environment to `production`; patch `fika-os-prod-hospitality` root directory from `/apps/hospitality` to `/apps/hospitality-booking`.

## C. Secrets (none exist in production; none reused from staging)
| Secret | Used by | Source |
|---|---|---|
| MNK_CANON_BRIDGE_TOKEN | Hub, Hospitality (must match) | new random, at least 32 bytes |
| FIKA_INTERNAL_API_TOKEN (@1) | Hub, CPU, Menu Planning, Delivered-In, Logistics | new random |
| GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON | Hospitality, CPU, Delivered-In | NEW service account in fika-os (staging uses fika-os-workspace-dwd-staging@fika-os-dev); a Workspace super admin must authorise its client ID for ONLY `https://www.googleapis.com/auth/drive`; then a key into the secret |
| FIKA_PDF_RENDERER_TOKEN | Hospitality, CPU, renderer | new random |
| production PDF renderer | Cloud Run `fika-pdf-renderer` in fika-os from services/pdf-renderer (staging: maxScale 20, startup CPU boost) | deploy, then set FIKA_PDF_RENDERER_URL |
| GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER | Hub | NOT created: email stays off; later a production mailer SA with `gmail.send` |

Each backend needs `firebase apphosting:secrets:grantaccess` for the secrets it references.

## D. Hospitality Drive config
Per OPLOC: `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<KEY>` (a real Workspace mailbox the DWD account impersonates). Quote/menu folders are auto-created under FIKA OS / Hospitality.

| Site | Env key | Owner mailbox | State |
|---|---|---|---|
| MNK | `OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F` | mnk@fikacatering.com (as staging) | carried in production yaml |
| RCoA | `OPLOC_BE0BECBE_B6CF_4D7F_9C1E_F36E689FEAB2` | **not set anywhere, even in staging** | needs your decision |
| Angel Court | `OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10` | none configured | needs owner (staging failed quote PDFs for this reason) |
| CFC | `OPLOC_0D8626F9_99BD_4DDE_9471_191DD0ABFB2E` | candidate cfc@fikacatering.com (AUTHMOD operational account) | needs confirmation |
| Munich Re | `OPLOC_95D84DE6_B3F5_4C8F_B3A7_6A313B17D701` | candidate munichre@fikacatering.com | needs confirmation |

CPU allergen PDFs use app owner `GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION` (staging: derek@; needs a production decision). **RCoA public booking SUBMISSION needs no Drive**; Drive is only needed when staff generate a quote or send to CPU. So the urgent RCoA link needs Hub + Hospitality + the RCoA OPLOC/mapping + `FIKA_RCOA_OPLOC_ID` (set in config), not Drive.

## E. Service Arrangements required for Delivered-In production access
Service definitions needed: **Delivered In Lunch** (`service-definition:a3a2038a-ea31-41af-8be6-5b8620e628d3`) and **Grab & Go** (`service-definition:82054fba-bfb8-4f76-92b5-a09c467f9437`); Coffee Bar is not used. All 17 arrangements are development-model records, so ALL need business confirmation. Delivered In Lunch arrangements (these define the 9 Delivered-In sites):

| Site | OPLOC | Arrangement | Evidence | Needs business confirmation |
|---|---|---|---|---|
| Bridgepoint | `oploc:a358ef5f-297b-4816-bbf5-7fef470e81d7` | `service-arrangement:63445c1b-d0ca-4613-9f73-38c00c8a8463` | staging menu-published orders exist | YES (development-model record) |
| Commerzbank | `oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c` | `service-arrangement:a3a14f6c-cebc-4531-a910-07a203d33f19` | staging menu-published orders exist | YES (development-model record) |
| FIKA Xchange | `oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d` | `service-arrangement:db875188-b96d-4ad7-ae63-a9f3a4da516d` | staging menu-published orders exist | YES (development-model record) |
| Haleon | `oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b` | `service-arrangement:4279f867-ee5d-479f-b415-7d65a2bc9108` | staging menu-published orders exist | YES (development-model record) |
| MNK | `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` | `service-arrangement:620575cc-8f9b-419c-9c9b-496d5da8cf25` | staging menu-published orders exist | YES (development-model record) |
| Munich RE | `oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701` | `service-arrangement:8961abf2-0090-48f4-b7c4-239b3163beab` | no staging evidence | YES (development-model record) |
| One Angel Court | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | `service-arrangement:4c19ea81-e30b-4373-bf61-d52d75e6638a` | staging menu-published orders exist | YES (development-model record) |
| Optiver | `oploc:763d5a92-5c8b-4f2e-bd45-f867db453a84` | `service-arrangement:0501bb56-6060-42d3-8d6e-ec22dc621b21` | no staging evidence | YES (development-model record) |
| Wise | `oploc:4e7b2838-95de-49c8-bf04-55200841d4cb` | `service-arrangement:2718d055-a6fb-4276-a1cc-3178434bd29e` | no staging evidence | YES (development-model record) |

Grab & Go arrangements (8): CFC, Commerzbank, FIKA Xchange, JET, MNK, Nesta, One Angel Court, Regent Hall. Not migrated until you confirm; they are written through Hub governance, not copied blindly.

## F. Production AUTHMOD bootstrap
Reconciliation key: normalised email. Every user must **sign in to production once** (creating the production Firebase Auth user) before an identity with a production UID can be created; unlinked imported identities cannot hold UID-bound grants. Existing path: `apps/integration-hub/scripts/bootstrap-staging-authmod.ts` (creates the application registry, the nominated person identity, the AUTHMOD admin grant and Hub access; hard-restricted to staging). A production variant restricted to project fika-os is required (small new script, not yet written).

Minimum launch bootstrap (staging facts, for your confirmation; nobody is created automatically):

| Person / account | Email | Staging access | Proposed production launch access | Must sign in first |
|---|---|---|---|---|
| Derek Buckley | derek@ | full; all 7 apps | AUTHMOD admin + all apps (bootstrap script) | yes |
| Ed Walker | ed@ | full; 10 sites | Hospitality + Hub (confirm) | yes |
| Sam Busby | sam@ | full | CPU access for head-chef allergen signing (confirm) | yes |
| Fika @ MNK | mnk@ | hospitality-booking, MNK | Hospitality at MNK | yes |
| Logistics @ Fika | logistics@ | cpu, delivered-in, logistics | confirm | yes |
| Fika @ Optiver / Seven / Funding Circle | optiver@ seven@ fundingcircle@ | delivered-in (+hospitality) at 1 site each | per Service Arrangement confirmation | yes |
| Francesco, Karoline, Tia | francesco@ karol@ tia@ | full access flag | confirm need at launch | yes |

Remaining staging identities (Anne, Brian, other site accounts) had no app access in staging and get none at launch.

## G. Candidate
- `release/production-candidate-2` stays at `2692b8f1bf55e2f1677d306e2c083adcdb246d56` (unchanged).
- Production config is on a new branch `release/production-candidate-2-config` (candidate 2 + production yaml + index set + config check; no application code changes).

## H. Execution plan (nothing below has been run)
Infrastructure: (1) enable PITR and delete protection on the production database (recommended rollback point; small cost); (2) create the read-packages bucket and grant access; (3) manual: Firebase Auth Google provider and authorised domains; (4) service accounts and Workspace DWD authorisation; (5) create secrets and grant backend access; (6) deploy the PDF renderer; (7) fill the 5 placeholders; (8) backend environment=production and the Hospitality root fix; (9) Cloud Scheduler jobs (CPU outbox recovery, Hub logistics outbox, menu publication outbox) pointing at production URLs; (10) wait for the 23 indexes to be READY.

Migration (create-only, in order): Hub canonical reference (161) + mappings (39) + revisions (38) + governance audit (66); Menu Planning catalogue (401); Menu Planning weeks (21) + days (147) + entries (1,258) with the strip transform; CPU saved sandwiches (227); AUTHMOD application registry (7). Total **2365**.

Deploy order (exact approved SHA each, one at a time, verify before the next): Hub, Hospitality (RCoA first), CPU, Menu Planning, Delivered-In, Logistics.

Rollback points: before migration, PITR or an export of the production database; the migration is create-only, so the create list is the delete list; app rollouts roll back by redeploying the prior build (the first rollout has no predecessor: disable the custom domain mapping); config is versioned in git.
