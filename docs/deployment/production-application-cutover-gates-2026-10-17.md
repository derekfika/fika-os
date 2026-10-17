# Production application cutover gates — 2026-10-17

## Follow-up status — 2026-10-17

This document's earlier Firebase Auth and DWD status below is historical and has been superseded by the later read-only verification in `production-drive-launch-preflight-2026-10-17.md`: Google sign-in/provider and production domains were verified; production Drive DWD was used successfully for the listed read-only Drive preflight. OAuth web-client secret rotation is a post-cutover security task at Derek's direction.

**Cutover remains HOLD for the remaining sign-in and operational Drive gates.** The SOL-approved AUTHMOD policy migration is complete: Derek's existing identity now has the approved organisation-scoped Hub Administer grant, while the production Firebase UID remains unbound and `fullAccess=false`. After Google sign-in, the existing fail-closed Hub identity-binding flow can bind Derek's UID; no one-time first-admin bootstrap command is needed. Do not bypass the governed sign-in/binding flow or set `fullAccess`.

The verified Drive configuration is also incomplete for a full operational rollout. Hospitality's per-dashboard quote/menu/matrix settings are absent from production and cannot be safely replaced by one shared folder root. MNK lacks its approved owner/folder/template values; CPU and Delivered-In lack approved owner/output roots (and Delivered-In's template). RCoA menu generation remains deferred because no approved template mapping exists. See the later Drive preflight record for exact IDs, pass/deferred states and config already prepared locally.

No rollout, Git push, application-writer restoration, business-data mutation, email enablement or recovery-job activation was performed while these gates remain open. The separately approved AUTHMOD policy migration changed only the approved policy collections and receipt; its exact execution is recorded in `production-authmod-policy-migration-2026-10-17.md`. Keep application writers frozen, email off and recovery jobs paused.

## Current verdict

**HOLD — remaining sign-in and operation-specific production Drive gates are not ready.** The AUTHMOD policy migration is complete, but Derek must still complete production Google sign-in so the existing identity-binding flow can bind the production UID. No application was deployed, no Git push occurred, no application Firestore writer was restored, and no production business data was changed in this task.

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

All six smoke checks can perform health/static checks while frozen. Read-only authenticated data checks are limited by the absence of Derek's production Firebase UID binding. First sign-in may not complete its Hub identity-binding write while Hub is frozen. Do no mutating smoke until the corresponding writer is deliberately restored. Keep email false and recovery paused throughout.

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
