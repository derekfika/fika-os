# Production cutover preparation — 2026-10-17

## Controlled application cutover attempt — Menu Planning held

- Starting `origin/main`: `f98cd5d999853866c4904f7631d21eb997a256a3`. The approved cutover branch was pushed at release SHA `35adc301a6682ed47f1a7791e5c6375d86e4f4b9`; `origin/main` was unchanged.
- Only `fika-os-prod-menu` was deployed. Build `build-2026-10-17-001` reached `READY`; rollout `build-2026-10-17-001` reached `SUCCEEDED`; source commit is the exact approved SHA. Runtime revision: `fika-os-prod-menu-build-2026-10-17-001` (100% traffic).
- Hosted URL and `menuplanner.fikacatering.com` returned HTTP 200. `/api/build-info` returned app `menu-planning` and the approved SHA. Unauthenticated catalogue API access returned `FIKA_SESSION_MISSING` (401), as expected. The available in-app browser had no signed-in Hub tab, so authenticated catalogue/package access could not be verified.
- Blocking smoke failure: the deployed HTML referenced Next static CSS/JS assets, and the five sampled asset URLs returned HTTP 404. The app is therefore not ready for use. The rollout stopped here; CPU, Hospitality, Logistics and Delivered-In were not deployed.
- Menu runtime `fika-prod-menu@fika-os.iam.gserviceaccount.com` remains without `roles/datastore.user` (only `roles/firebaseapphosting.computeRunner` was present). No writer was restored. No production business writes were performed by this task. Hub remained HTTP 200; recovery jobs remained PAUSED; email remained explicitly `false`, with no mailer secret.
- No code/config changes were made. Follow-up requires diagnosing/fixing the static asset serving failure, redeploying the exact approved release after any necessary approval of a changed SHA, then rerunning authenticated read-only smoke before considering writer restoration or the next app.

## Initial preparation decision

**HOLD — production is not ready for rollout.** Production Authentication/Google sign-in and Workspace DWD still need administrator setup. All six live App Hosting custom-domain mappings are active, but this task had to align the prepared production YAML hostnames to those live mappings. The production Auth configuration read returned HTTP 403 for the current operator, so its provider/domain state could not be confirmed automatically. No App Hosting application rollout was started.

## Scope and provenance

- Source baseline: `origin/main` `f98cd5d999853866c4904f7631d21eb997a256a3`.
- Production GCP/Firebase project: `fika-os`; staging project: `fika-os-dev`.
- Prepared backends: Integration Hub, Hospitality Booking, CPU Production, Menu Planning, Logistics and Delivered-In.
- Their App Hosting backend environment is set to `production`, selecting each app's `apphosting.production.yaml`; Hospitality's production root directory is `apps/hospitality-booking`.
- Each production backend now uses a dedicated production runtime service account. No staging identity or credential was copied.

## Prepared infrastructure

- Production YAML files provide production Firebase project/app identifiers, production service URLs, cross-app origin allowlists, `.fikacatering.com` session cookie scope, and runtime secret references. Hospitality customer-email delivery is explicitly `false` in both Hospitality and Hub.
- Session cookies now use `fika_os_session_staging` in staging and `fika_os_session` in production/local. Hosted cookie security, HttpOnly, SameSite=Lax, path, age and configured domain attributes are preserved.
- Private `europe-west4` buckets exist for read packages and Firestore backups, with uniform bucket-level access and public access prevention. Only the package bucket has app runtime object access; the backup bucket remains app-inaccessible.
- Fresh random versions of `FIKA_INTERNAL_API_TOKEN`, `MNK_CANON_BRIDGE_TOKEN` and `FIKA_PDF_RENDERER_TOKEN` are version 2. The unusable initial version 1 values are disabled. Runtime grants follow app ownership; values are not stored in this repository.
- Authenticated PDF renderer: `https://fika-pdf-renderer-prod-qi42jwabmq-ez.a.run.app`, revision `fika-pdf-renderer-prod-00002-xcb`, 0–3 instances, 1 CPU, 1 GiB memory, concurrency 2, 60-second timeout, and a dedicated runtime identity. Contract smoke checks returned PDF for valid authenticated input, 401 for missing/wrong tokens, and 422 for invalid HTML. No artifact was persisted.
- Three Cloud Scheduler recovery jobs exist in `europe-west4`, all **PAUSED**: CPU durable outbox, Logistics projection outbox, and Menu publication outbox. Each is configured for a one-minute schedule, 25-item bound and retry policy; no job has been run.
- Production Firestore now has the Hub server-only deny-all ruleset. Production has 23 READY composite indexes: every repository index signature is present, plus one older CPU change index. No indexes were deployed or changed.
- No production business data was copied, seeded, or mutated. No customer emails were sent or enabled. No App Hosting application was deployed, no production traffic was moved, and `main` was not pushed.

## Required external administrator actions

Complete these before submitting the production app set for SOL review:

1. **Firebase Authentication and Google sign-in**
   - In Firebase project `fika-os`, initialize Authentication and enable the Google provider. Configure the OAuth web client and verify the authorized callback `https://fika-os.firebaseapp.com/__/auth/handler` in Firebase Console.
   - Authorize `fika-os.firebaseapp.com`, the six production App Hosting backend domains, and the six active custom hosts listed below. Keep AUTHMOD fail-closed; enroll/bind production users through the production Hub workflow.
   - App Hosting backend domains: `fika-os-prod-hub--fika-os.europe-west4.hosted.app`, `fika-os-prod-hospitality--fika-os.europe-west4.hosted.app`, `fika-os-prod-cpu--fika-os.europe-west4.hosted.app`, `fika-os-prod-menu--fika-os.europe-west4.hosted.app`, `fika-os-prod-logistics--fika-os.europe-west4.hosted.app`, `fika-os-prod-deliveredin--fika-os.europe-west4.hosted.app`.
   - The production Auth config API returned HTTP 403 to the current operator. After admin setup, grant/read the required Firebase Auth configuration permission or verify the provider and domain list in Console. Do not import staging UID bindings.
   - Public Firebase client configuration in each `apphosting.production.yaml`:

     | App | `NEXT_PUBLIC_FIREBASE_APP_ID` |
     | --- | --- |
     | Integration Hub | `1:397503564317:web:573a8320c8e04e3d3e54f4` |
     | Hospitality Booking | `1:397503564317:web:3c87d1a4000cd9613e54f4` |
     | CPU Production | `1:397503564317:web:b6174aedc02ae65d3e54f4` |
     | Menu Planning | `1:397503564317:web:3c0dddf561da96583e54f4` |
     | Logistics | `1:397503564317:web:31703e57e01816e83e54f4` |
     | Delivered-In | `1:397503564317:web:439a39c2f1d66aa33e54f4` |

     All six use `NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCFryGfpWmJ52Zqikk3v1AozINumPeE-TE`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=fika-os.firebaseapp.com`, and `NEXT_PUBLIC_FIREBASE_PROJECT_ID=fika-os`. These are public browser Firebase config values, not service-account credentials.

2. **Workspace Drive domain-wide delegation**
   - For service account `fika-prod-workspace-dwd@fika-os.iam.gserviceaccount.com`, enable Google Workspace domain-wide delegation in Google Cloud IAM. Its OAuth client ID is `104667768587124731620`.
   - In Google Admin Console → Security → Access and data control → API controls → Domain-wide delegation, add the client ID and authorize `https://www.googleapis.com/auth/drive` for production Drive operations.
   - The current Drive adapter requires service-account JSON (including its private key) in Secret Manager secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON`. Create/provide it through the approved secure process; do not reuse a staging key. Never paste credential material into this repository or task output.
   - Grant the secret only to the production Hub, Hospitality, CPU and Delivered-In runtime identities using the App Hosting secret access grant workflow. Do not grant it to Logistics or Menu Planning.
   - A separate code path uses `https://www.googleapis.com/auth/gmail.send` and secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER`; production YAML does not wire that secret and email delivery remains `false`. Do not authorize or configure the mailer scope/secret in this cutover.

3. **Production custom domains and DNS**
   - Live App Hosting mappings are already active with ownership, host and certificate states all `ACTIVE`; App Hosting currently requests zero DNS updates. DNS resolves all six to `A 35.219.200.98`:

     | Active domain | Backend |
     | --- | --- |
     | `os.fikacatering.com` | `fika-os-prod-hub` |
     | `hospitality.fikacatering.com` | `fika-os-prod-hospitality` |
     | `cpu.fikacatering.com` | `fika-os-prod-cpu` |
     | `menuplanner.fikacatering.com` | `fika-os-prod-menu` |
     | `logistics.fikacatering.com` | `fika-os-prod-logistics` |
     | `delivered-in.fikacatering.com` | `fika-os-prod-deliveredin` |

   - Production YAML now uses these exact hosts in cross-app origins and base URLs. The former `hub.fikacatering.com` and `menu-planning.fikacatering.com` names have no DNS response and are not mapped. If either is desired instead, decide that before rollout and use App Hosting's domain wizard; follow only the TXT/A/CAA records it returns. Do not guess records.

## Validation record

The production YAML files parse and each declares `FIKA_RUNTIME_MODE=production`, `FIREBASE_PROJECT_ID=fika-os`, the matching public Firebase project ID, and token references rather than plaintext token values. All six typechecks and production builds passed. Tests: Hub session 13/13, Hospitality 206/206, Menu Planning 220/220, Logistics 449/449; Delivered-In 142/143 with one existing allergen-fixture failure. Broader Hub and CPU suites had failures in untouched areas and were stopped during long-running cases. Final cloud checks confirmed the Hub rules release, renderer revision, three paused jobs, and valid Secret Manager versions with invalid initial versions disabled. `git diff --check` passed. See the task return for suite details and remaining limits.
