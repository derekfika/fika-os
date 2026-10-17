# Production application cutover gates — 2026-10-17

## Latest status — CPU Production fresh release held (2026-10-17)

This section supersedes the earlier CPU note below where it described the missing-package recovery write as a read-only design defect. Recovery of a missing hosted package is the intended lazy/self-healing path; the safe cutover action is to bootstrap its exact derived scope before the viewer-only smoke.

- Fixed and pushed only `prod-cutover-preparation-2026-10-17` at release SHA `c0df470f95c67dc361b889c453c6a6ad8912efa2`. CPU backend `fika-os-prod-cpu` build `build-2026-10-17-006` / Cloud Build `e75eaf18-5fe9-4032-b6a3-c391752208dd` reached READY/SUCCESS; rollout `build-2026-10-17-006` SUCCEEDED; revision `fika-os-prod-cpu-build-2026-10-17-006` is READY. `/api/build-info` returned that exact SHA. CPU, Hub, and Menu root health checks returned HTTP 200. No other backend was deployed.
- The deployed revision is `FIKA_RUNTIME_MODE=production`, `FIREBASE_PROJECT_ID=fika-os`, and the approved production snapshot bucket. Its effective environment has neither `GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION` nor `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON`. The production matrix readiness gate now requires DWD, owner, and explicit `GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID`; the production `cpu-default` storage resolver independently rejects a missing/invalid explicit folder before any Drive API call. The staging owner/DWD values remain in `apphosting.staging.yaml`; they were removed from the inherited base and CPU production YAML. No Drive call was made.
- Production traces identify the missing default week as `weekCommencing=2026-10-19`. The authenticated Hub-backed diagnostic returned zero canonical source orders; CPU's projection head returned `revision=0`, `packageVersion=0`, and the diagnostic returned `projectionCount=0`. Thus the only intended recovery scope is the empty week projection. If it succeeds, the existing builder writes the derived projection document `fikaCpuProductionDayProjectionsV1/week:2026-10-19`, package-head document `fikaCpuProjectionPackageHeadsV1/cpu-production_projection_week:2026-10-19`, and one immutable object under `snapshots/cpu-production/projection-week/`; it does not write orders, production plans, changes/cursors, or allergen approvals.
- For the bounded bootstrap only, project-level `roles/datastore.user` was temporarily added to `fika-prod-cpu@fika-os.iam.gserviceaccount.com` while its existing viewer binding remained. The exact `GET /api/production?projection=1&weekCommencing=2026-10-19&scope=all` returned HTTP 503 with Firestore `PERMISSION_DENIED`. The trace recorded a transaction write attempt, but after that denial the head still reported revision 0, the diagnostic still reported zero projection documents, and the projection-week GCS prefix contained no objects. No projection, package-head, package object, business document, or Drive object was successfully written. The temporary user role was removed with its unconditional binding selector; CPU is back to project-level `roles/datastore.viewer` only. The denied write remains unexplained; Policy Troubleshooter is not enabled and was not enabled for this task. Do not retry until the runtime write authorization is understood and verified.
- Grab & Go raw compressed object integrity was previously verified, but the required production runtime path is not currently available: both the Delivered-In custom URL and hosted URL returned App Hosting “Backend Not Found”; CPU `/api/grab-and-go` returned `Delivered-In Grab & Go source is unavailable (404)`. Therefore its runtime manifest/API/UI verification remains incomplete. No other backend deployment was authorized or attempted.
- Current app Firestore data-role readback: Hub and Menu `roles/datastore.user`; CPU `roles/datastore.viewer`; Hospitality, Logistics, and Delivered-In have no direct Firestore data role. CPU was not promoted. The three recovery Scheduler jobs remain PAUSED; production Hub and Hospitality config set `FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED` to `false`; no mailer/Gmail secret exists. No AUTHMOD, staging, source order, allergen, or Drive content mutation occurred.
- A read-only production AUTHMOD account read showed Derek `fullAccess=false` and only the organisation-scoped `authmod` / `Administer` special authority. `production.allergen-sign` / `Approve`, `production.allergen-final-approve` / `Approve`, and `menu.publish` / `Publish` were absent.
- Status: **HOLD**. Remaining blockers: runtime Firestore create remains denied despite the temporary project binding, and the Delivered-In production backend is unavailable for catalogue consumer verification. Keep CPU viewer-only; do not promote its writer or deploy another backend under this task.

## CPU Production rollout — held before writer promotion (2026-10-17)

- Deployed only the approved application SHA `35adc301a6682ed47f1a7791e5c6375d86e4f4b9` to backend `fika-os-prod-cpu` (repository `derekfika-fika-os`, root `/apps/cpu-production`). Build `build-2026-10-17-005` reached READY, rollout `build-2026-10-17-005` SUCCEEDED, and Cloud Run revision is `fika-os-prod-cpu-build-2026-10-17-005`. `/api/build-info` returned the exact SHA; the custom CPU URL rendered the CPU dashboard. No other backend was deployed.
- Before rollout, the CPU runtime had only `roles/firebaseapphosting.computeRunner` and no Firestore data role. Added project-scoped `roles/datastore.viewer` to `fika-prod-cpu@fika-os.iam.gserviceaccount.com`. App Hosting's existing Drive-only DWD secret was registered for this backend; the CPU runtime was already among the four approved secret accessors. No secret value, scope, or credential was changed.
- Derek's existing browser session passed Hub CPU admission for canonical identity `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7`, with 19 scoped active OPLOCs. The CPU dashboard loaded. Its startup trace recorded `projection.monotonic-write` (`estimatedFirestoreWrites: 1`) during `GET /api/production`, alongside a missing CPU projection package fallback. This is a failed read-only smoke gate: no `roles/datastore.user` promotion was made. The `datastore.viewer` role has read-only Firestore permissions; it remains in place while the app is held. Do not claim zero write attempts or successful denial from an audit event; none was available in the inspected logs.
- Read the approved Grab & Go object from the production bucket with GCS decompression disabled: 1,009 compressed bytes, SHA-256 `b33963e3f45a3930d2511c9e23cd14921b822c7ef5c4660ad39544c2fe68719f`. The runtime catalogue API/UI read was not completed because the read-only startup write attempt triggered the stop condition.
- CPU allergen-matrix Drive output is not safely deferred by current production runtime configuration. The deployed revision contains `GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION` (Derek's email) and the Drive DWD secret; the production YAML has no explicit CPU output folder. In code, `resolveArtifactFolder` falls back to Drive `root` and `driveFolderPath` can create `FIKA OS/CPU Production/Production` folders. No Drive operation was invoked. This path must be governed/disabled before claiming it fails closed; do not materialize output during this held cutover.
- Current project Firestore data-role readback: Hub and Menu `roles/datastore.user`; CPU `roles/datastore.viewer`; Hospitality, Logistics, and Delivered-In have no Firestore data role. Three recovery Scheduler jobs remain PAUSED. No mailer/Gmail secret is present; only the approved Drive DWD secret exists. No staging operation, successful Firestore business-data write evidenced in inspected logs, allergen signature, production order, or additional deployment was performed by this cutover.
- Status: **HOLD**. Required before retry: eliminate the CPU startup projection write on the read-only path (or provide an explicitly approved safe read-only smoke path); make CPU Drive output fail closed until a governed owner and explicit output root are configured; then select and approve a release SHA if code/config changes are needed. Keep CPU Firestore writer at viewer-only until a fresh smoke passes.

## Latest status — Menu Planning cutover complete (2026-10-17)

This section supersedes earlier Menu Planning hold and writer-freeze notes below. The deployed Menu backend remains `fika-os-prod-menu`, build/rollout `build-2026-10-17-001`, revision `fika-os-prod-menu-build-2026-10-17-001`, source SHA `35adc301a6682ed47f1a7791e5c6375d86e4f4b9`.

- Before this cutover, `fika-prod-menu@fika-os.iam.gserviceaccount.com` had no Firestore data role. Project IAM was changed first to `roles/datastore.viewer` for the authenticated read-only smoke. This role's effective permissions include Firestore get/list but no create/update/delete permissions.
- Derek's existing production session passed Hub AUTHMOD Menu admission. The Menu shell loaded; `GET /api/catalogue` returned HTTP 200 with the current production package (version 7, 215 entries, compressed package hash `b79546b1…afe8f`, source hash `5f3ae960…577215`; the source manifest reports 399 canonical records). `GET /api/rolling-menu` returned the empty, in-memory default draft for WC 12 Oct 2026; it was not saved. `GET /api/oplocs` returned the nine OPLOCs in Derek's current scope. The Week Planner, dish picker, Portion Planner, and Add destination selector rendered. No Save or Publish action was used.
- Menu runtime data traces during the viewer-only smoke recorded 19 trace totals with zero estimated Firestore writes or deletes. The empty default week comes from `emptyWeek()` and is only a response fallback when no stored week exists; it is not evidence of a Firestore document. No production menu, catalogue, or publication data was mutated.
- After that read-only smoke passed, the Menu runtime was promoted to `roles/datastore.user`; the temporary `roles/datastore.viewer` binding was removed. Current Firestore data-role bindings for application runtimes are Hub and Menu only. CPU, Logistics and Delivered-In remain without Firestore data roles; Hospitality has no direct Firestore role.
- The three recovery Scheduler jobs remain PAUSED; the email-delivery flag remains explicitly `false`; no mailer secret is present. AUTHMOD policy, staging, application deployment, and publication state were not changed. The previously recorded internal `returnTo=https://0.0.0.0:8080/` remains a post-cutover navigation defect and was not changed here.

### Read-only IAM state for the remaining application cutovers

Removing `roles/datastore.user` also removes server-side Firestore reads. Do not attempt Firestore-dependent authenticated read smoke with no Firestore data role. For each app below, add only the app runtime's project-scoped `roles/datastore.viewer` immediately before its read-only data smoke. Promote that same runtime to `roles/datastore.user` only after smoke passes and only when its write-owning workflow is ready; remove the viewer binding after promotion. Do not grant these roles ahead of that app's cutover.

| App | Runtime identity | Read-only startup/data path evidence | Required pre-smoke IAM | After successful read-only smoke |
|---|---|---|---|---|
| CPU Production | `fika-prod-cpu@fika-os.iam.gserviceaccount.com` | CPU reads canonical production plans and bounded Menu Planning publication/snapshot packets through Firestore repositories (`apps/cpu-production/lib/production-plan-repository.ts`, `menu-planning-week-packet.ts`). | Temporarily grant `roles/datastore.viewer`. | `roles/datastore.user` is required for CPU-owned production/release/outbox mutations; promote only after the read-only smoke passes. |
| Logistics | `fika-prod-logistics@fika-os.iam.gserviceaccount.com` | Logistics runtime reads runs, stops, movements, loads, assignments, change state and day projections through its Firestore store/repositories (`apps/logistics/lib/store.ts`, `logistics-materialisation.ts`). | Temporarily grant `roles/datastore.viewer`. | `roles/datastore.user` is required for logistics-owned assignment/movement state; promote only after the read-only smoke passes. |
| Delivered-In | `fika-prod-deliveredin@fika-os.iam.gserviceaccount.com` | Delivered-In reads projection heads, site-menu state, CPU release receipts and Menu Planning publication packets (`apps/delivered-in/lib/delivered-in-projection-store.ts`, `site-menu-store.ts`, `cpu-release-receipts.ts`, `menu-planning-week-packet.ts`). | Temporarily grant `roles/datastore.viewer`. | `roles/datastore.user` is needed for receipt/acknowledgement and projection-owned state; promote only after the read-only smoke passes. |
| Hospitality Booking | `fika-prod-hosp@fika-os.iam.gserviceaccount.com` | Current production architecture uses Hub APIs for governed state and has no direct Firestore data path. | No direct Firestore role. | Keep no direct Firestore role unless a future code-path review proves a direct need. |

The Menu read-only smoke exposed a prior process gap, not a Menu defect: a frozen runtime with zero Firestore permissions cannot exercise Firestore-backed startup reads. The `viewer → smoke → user` sequence above is now the required procedure for CPU, Logistics, and Delivered-In. Keep email OFF and recovery jobs PAUSED throughout.

## Follow-up status — 2026-10-17

This document's earlier Firebase Auth and DWD status below is historical and has been superseded by the later read-only verification in `production-drive-launch-preflight-2026-10-17.md`: Google sign-in/provider and production domains were verified; production Drive DWD was used successfully for the listed read-only Drive preflight. OAuth web-client secret rotation is a post-cutover security task at Derek's direction.

**Hub-only cutover is ready for Derek's production sign-in.** The Integration Hub has been deployed at the approved commit and its writer restored after non-mutating smoke checks. Derek's existing identity has the approved organisation-scoped Hub Administer grant; his production Firebase UID remains unbound and `fullAccess=false`. The existing fail-closed Hub identity-binding flow can bind his UID after Google sign-in; no one-time first-admin bootstrap command is needed. The broader multi-app rollout remains on hold for operation-specific Drive configuration. Do not bypass the governed sign-in/binding flow or set `fullAccess`.

The verified Drive configuration is also incomplete for a full operational rollout. Hospitality's per-dashboard quote/menu/matrix settings are absent from production and cannot be safely replaced by one shared folder root. MNK lacks its approved owner/folder/template values; CPU and Delivered-In lack approved owner/output roots (and Delivered-In's template). RCoA menu generation remains deferred because no approved template mapping exists. See the later Drive preflight record for exact IDs, pass/deferred states and config already prepared locally.

The Hub-only rollout and its writer restoration are recorded below. No other app rollout, Git merge, business-data mutation, email enablement or recovery-job activation was performed. The separately approved AUTHMOD policy migration changed only the approved policy collections and receipt; its exact execution is recorded in `production-authmod-policy-migration-2026-10-17.md`. Keep the other five application writers frozen, email off and recovery jobs paused.

## Current verdict

**READY FOR DEREK PRODUCTION SIGN-IN — HUB ONLY.** Hub is deployed at the exact approved SHA, non-mutating smoke passed, and only the Hub writer has been restored. The AUTHMOD policy migration is complete; Derek must now sign in with Google so the existing identity-binding flow can bind his production UID. Other application deployments and writers remain frozen pending their separate cutover gates.

The original production Firestore bootstrap remains intact at 2,259 documents; the separately migrated AUTHMOD policy and receipt add 121 documents (2,380 total). The six application runtime identities remain frozen for Firestore writes; the three recovery jobs remain paused; customer email remains unavailable/off.

## Firebase Authentication

- Production Firebase Authentication was uninitialized at the start of this task. It was initialized with the Identity Platform initialization API.
- The production Google provider is **not enabled**. The current `defaultSupportedIdpConfigs` response is empty.
- The Auth callback `https://fika-os.firebaseapp.com/__/auth/handler` returned HTTP 200.
- The following authorized domains are now present alongside the existing `fika-os.firebaseapp.com` and `fika-os.web.app` domains:
  - `fika-os-prod-hub--fika-os.europe-west4.hosted.app`
  - `fika-os-prod-hospitality--fika-os.europe-west4.hosted.app`
  - `fika-os-prod-cpu--fika-os.europe-west4.hosted.app`
  - `fika-os-prod-menu--fika-os.europe-west4.hosted.app`
  - `fika-os-prod-logistics--fika-os.europe-west4.hosted.app`
  - `fika-os-prod-deliveredin--fika-os.europe-west4.hosted.app`
  - `os.fikacatering.com`, `hospitality.fikacatering.com`, `cpu.fikacatering.com`, `menuplanner.fikacatering.com`, `logistics.fikacatering.com`, `delivered-in.fikacatering.com`
- All six production YAMLs use the `fika-os` project/auth domain and their existing production Firebase web-app IDs. No application deploy was used to test Auth.

### Required Firebase Console action

1. Open Firebase Console and select project **fika-os**.
2. Open **Authentication → Sign-in method** (or **Authentication → Providers** in the current console UI).
3. Select **Google**, enable it, set the production support email, and save.
4. If prompted, create/select the production OAuth 2.0 Web client. Keep the displayed client ID/secret in Google's/Firebase's credential stores; do not put the secret in this repository. Confirm the authorized redirect URI is exactly `https://fika-os.firebaseapp.com/__/auth/handler`.
5. Open **Authentication → Settings → Authorized domains** and confirm the 12 production hosts above plus the existing Firebase domains remain listed.
6. Perform a sign-in-only check after the controlled app rollout; do not treat it as proof of AUTHMOD authorization.

## Initial production AUTHMOD administrator

The intended Derek identity already exists:

- `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7`
- active identity; normalized email `derek@fikacatering.com`
- production Firebase UID/provider binding is currently absent, as required by the bootstrap transform
- `fullAccess=false`; the approved migration added an organisation-scoped `integration-hub` / `authmod` / `Administer` grant and a Hub app assignment. No Firebase UID was copied or assigned.

After valid Google sign-in, Integration Hub's existing `resolveSessionIdentity` flow verifies the Firebase token and allowed company email, looks up the unique active email identity, binds the Firebase UID through the governed `bindExternalIdentity` mutation, and emits `auth-identity-bound` audit evidence. It fails closed for duplicates, inactive identities, unknown email, invalid/old tokens, or unavailable authority.

That flow only binds identity; authority now comes from the completed SOL-approved migration, which created the three production-native enrollment records and durable migration audit receipt. Therefore, **a first-admin bootstrap command is unnecessary**. After successful sign-in, the governed binding flow can bind Derek's production UID to this existing identity and the migrated Administer authority becomes effective. The flow remains fail-closed for invalid, duplicate, inactive, or unknown identities.

## Workspace Drive DWD

- Service account exists: `fika-prod-workspace-dwd@fika-os.iam.gserviceaccount.com`.
- Its OAuth client ID is `104667768587124731620`.
- Required scope is `https://www.googleapis.com/auth/drive` only. `gmail.send` is not authorized or in scope.
- Production Secret Manager does not currently contain `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON`.
- No user-managed service-account key was found. No private key was created or exposed by this task.
- Google Workspace Admin domain-wide delegation has not been verified. No Drive preflight was run.
- The attempt to create/store the service-account credential and secret-level grants was rejected by the command runner policy before any such command executed. This remains outstanding; no key file or secret version was created.

### Required Workspace Admin Console action

In **Google Admin Console → Security → Access and data control → API controls → Domain-wide delegation**, add OAuth client `104667768587124731620` with exactly `https://www.googleapis.com/auth/drive`. Do not add `gmail.send`.

After that approval, use the approved secure credential issuance process to provision `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` without displaying or committing its private key. Grant Secret Manager accessor at the secret resource only to these four production app identities:

- Hub: `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com`
- Hospitality: `fika-prod-hosp@fika-os.iam.gserviceaccount.com`
- CPU: `fika-prod-cpu@fika-os.iam.gserviceaccount.com`
- Delivered-In: `fika-prod-deliveredin@fika-os.iam.gserviceaccount.com`

Do not grant the secret to Menu Planning, Logistics, or application-wide identities. The YAMLs already reference the DWD secret for those four apps. Production owner emails, Drive root folder IDs and configured template IDs for RCoA, One Angel Court and CPU are absent from the six production YAMLs, so Derek/domain owners must provide and govern them before a meaningful access preflight. Do not copy staging folder IDs.

Once the credential and owner/root/template configuration exist, use the actual delegated production identity for read-only checks of owner impersonation, folder existence/access, and configured template readability. Create no Drive artifact.

## Production configuration read-back

All six `apphosting.production.yaml` files parse and use production project/runtime settings, `fika-os`, production cross-app URLs, the production package bucket where used, the production PDF renderer where used, `.fikacatering.com` cookie isolation, and the production Firebase config. No executable reference to `fika-os-dev`, staging runtime mode, staging hosted URLs, staging bucket names, or staging secret versions was found. Email flags in Hub and Hospitality are explicitly `false`.

The current production backends and deployment roots are:

| Order | App / backend | Production URL | Root | Runtime service account | Secrets referenced by production YAML | Firestore need |
|---:|---|---|---|---|---|---|
| 1 | Integration Hub / `fika-os-prod-hub` | `https://fika-os-prod-hub--fika-os.europe-west4.hosted.app` | `apps/integration-hub` | `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com` | `FIKA_INTERNAL_API_TOKEN`, `MNK_CANON_BRIDGE_TOKEN`, `FIKA_PDF_RENDERER_TOKEN`, `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` | Write required; restore only after initial Admin path is approved |
| 2 | Menu Planning / `fika-os-prod-menu` | `https://fika-os-prod-menu--fika-os.europe-west4.hosted.app` | `apps/menu-planning` | `fika-prod-menu@fika-os.iam.gserviceaccount.com` | `FIKA_INTERNAL_API_TOKEN` | Write required for governed menu/publication state |
| 3 | CPU Production / `fika-os-prod-cpu` | `https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app` | `apps/cpu-production` | `fika-prod-cpu@fika-os.iam.gserviceaccount.com` | `FIKA_INTERNAL_API_TOKEN`, `FIKA_PDF_RENDERER_TOKEN`, `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` | Write required for CPU production/release state |
| 4 | Hospitality Booking / `fika-os-prod-hospitality` | `https://fika-os-prod-hospitality--fika-os.europe-west4.hosted.app` | `apps/hospitality-booking` | `fika-prod-hosp@fika-os.iam.gserviceaccount.com` | `MNK_CANON_BRIDGE_TOKEN`, `FIKA_PDF_RENDERER_TOKEN`, `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` | No direct Firestore access required; uses Hub APIs |
| 5 | Logistics / `fika-os-prod-logistics` | `https://fika-os-prod-logistics--fika-os.europe-west4.hosted.app` | `apps/logistics` | `fika-prod-logistics@fika-os.iam.gserviceaccount.com` | `FIKA_INTERNAL_API_TOKEN` | Write required for logistics-owned operational state |
| 6 | Delivered-In / `fika-os-prod-deliveredin` | `https://fika-os-prod-deliveredin--fika-os.europe-west4.hosted.app` | `apps/delivered-in` | `fika-prod-deliveredin@fika-os.iam.gserviceaccount.com` | `FIKA_INTERNAL_API_TOKEN`, `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` | Write required for acknowledgements/receipt and projection state |

The Hub non-mutating smoke passed before its writer was restored. Other app smoke checks can perform health/static checks while frozen. Read-only authenticated data checks for those apps are limited by the absence of Derek's production Firebase UID binding. Do no mutating smoke until the corresponding writer is deliberately restored. Keep email false and recovery paused throughout.

## Hub-only production rollout — 2026-10-17

- Auth read preflight: active gcloud user and ADC principal both resolved to `derek@fikacatering.com`; gcloud's default project was `fika-os-dev`, so all production calls specified `fika-os` explicitly. The earlier Identity Toolkit 403 resulted from omitting the ADC quota-project header, not missing IAM. Cloud Resource Manager confirmed `firebaseauth.configs.get`; no `roles/firebaseauth.viewer` binding was added.
- Firebase Auth readback with quota project `fika-os`: project initialized, `google.com` enabled, all 14 required Firebase/production hosted/custom domains authorized, and `https://fika-os.firebaseapp.com/__/auth/handler` returned HTTP 200. No OAuth secret fields were requested or printed; no provider configuration or OAuth secret was changed.
- App Hosting backend `fika-os-prod-hub` is linked to repository `derekfika-fika-os`, root `/apps/integration-hub`, runtime identity `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com`. DNS for `os.fikacatering.com` resolves to the configured production address and HTTPS terminates successfully. The pre-first-deploy 404 was expected because there were zero builds/rollouts.
- Pushed only branch `prod-cutover-preparation-2026-10-17` at commit `3a015bce5f38e777585f9d20492d17085570a977`; no merge to `main`. `origin/main` remained `f98cd5d999853866c4904f7631d21eb997a256a3`.
- First exact-SHA build (`build-2026-10-17-001`) failed before rollout because App Hosting had not registered the existing DWD secret access. The secret value/version was not changed. Applied `firebase apphosting:secrets:grantaccess` for this secret and Hub backend only; secret-level access remains limited to the four approved app runtime identities. App Hosting's service agent received resource-scoped `roles/secretmanager.secretVersionManager`, and the Hub runtime received resource-scoped `roles/secretmanager.viewer`; the prior runtime `roles/secretmanager.secretAccessor` bindings remain for Hub, CPU, Hospitality and Delivered-In.
- Successful Hub-only build: `build-2026-10-17-002`, state READY, source SHA exactly `3a015bce5f38e777585f9d20492d17085570a977`. Rollout: `build-2026-10-17-002`, state SUCCEEDED. Cloud Run revision: `fika-os-prod-hub-build-2026-10-17-002`; image digest `sha256:4d01ecf628b615aaadfd87f5774fed2a38a1433137439b54f31066158e2ffd52`.
- Non-mutating smoke: custom domain and hosted URL returned HTTP 200 with the FIKA OS page; 12 referenced JavaScript/CSS assets loaded successfully; compiled client bundle contains the Google sign-in action and production Firebase auth domain, with no staging endpoint strings. `/api/auth/runtime` reported `mode=production`, `projectId=fika-os`, Google Workspace client configuration available. Unauthenticated `/api/auth/session` and `/api/launcher` returned 401. The no-cookie session guard exits before AUTHMOD identity lookup; no login was submitted.
- After smoke, restored project-level `roles/datastore.user` only for `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com`. IAM readback confirms the other five app identities remain without that role; Hospitality remains without direct Firestore write access.
- Firebase Google sign-in and production domains are ready. Derek should now sign in at `https://os.fikacatering.com` using his FIKA Google Workspace account. Expected binding remains to `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7`; automation stopped before sign-in. No UID binding, AUTHMOD policy change, email enablement, recovery activation, staging mutation, or other app deployment occurred.

## Exact controlled rollout and writer-restoration sequence

There is no deployment in this task. When separately authorized, first have one exact release commit available to all connected App Hosting backends, and submit that identical SHA in this order:

1. Integration Hub — central AUTHMOD/session and API authority.
2. Menu Planning — its publication path is consumed by CPU and Delivered-In.
3. CPU Production — consumes Hub and Menu contracts and serves Hospitality/Logistics/Delivered-In dependencies.
4. Hospitality Booking — Hub-owned booking workflow and CPU handoff dependencies are then available.
5. Logistics — Hub/CPU dependencies are available.
6. Delivered-In — deploy last as the downstream consumer of Hub/Menu/CPU.

Use `firebase apphosting:rollouts:create --project=fika-os --git-commit <EXACT_RELEASE_SHA> <BACKEND_ID>` once per backend. The source is Git-connected, so a local-only SHA cannot be fetched by App Hosting; the exact release SHA must first be pushed under a separately authorized push. Do not use a moving branch head or deploy from this preparation branch until the release SHA is explicitly selected.

Keep all six Firestore writers frozen during rollout and non-mutating smoke. After auth, Admin enrollment and read-only smoke gates pass, restore `roles/datastore.user` project binding only for the five identities that had that role removed, one at a time, before the first approved write smoke for that app:

1. Hub, only after Derek's production sign-in has bound his UID to the existing identity and read-only AUTHMOD smoke passes; it is needed for AUTHMOD and future identity binding.
2. Menu Planning, before first governed menu write/publication smoke.
3. CPU Production, before first production write/release smoke.
4. Logistics, before first logistics mutation/recovery operation (recovery Scheduler remains paused until separately approved).
5. Delivered-In, before first receipt/acknowledgement mutation smoke.

The exact saved IAM freeze record lists those five `gcloud projects add-iam-policy-binding fika-os --member="serviceAccount:<identity>" --role=roles/datastore.user` actions. Hospitality's identity had no Firestore write grant before freeze and must remain without one; do not restore it. `roles/datastore.user` is the narrowest existing practical role used by this application set; IAM is project-level here, not collection-level. Keep `roles/firebaseauth.admin` on the Hub runtime separate from Firestore restoration. Do not re-enable recovery jobs or email as part of role restoration.

## Validation performed

- Auth initialization, provider/domain readback, callback HTTP check; Google provider remains disabled.
- Six production YAML parses/read-backs; no staging wiring found.
- Auth/session and Drive-config focused tests: 137/137 passed across six apps.
- Six app typechecks passed; six production builds passed.
- `git diff --check` passed before documentation-only update.
- No application deployment, Git push, Firestore write, writer restoration, email enablement, or recovery activation.
