# Production cutover preparation — 2026-10-17

## Decision

**HOLD — production is not ready for SOL review or customer-facing App Hosting rollout.** The production-only configuration and supporting infrastructure are prepared, but Firebase Authentication/Google sign-in, Workspace domain-wide delegation, and the production custom domains still require external administrator setup. No App Hosting application rollout was started.

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
   - In Firebase Console for `fika-os`, initialize Authentication and enable Google as a sign-in provider.
   - Attach/configure the Google OAuth web client. Confirm Firebase's required callback URI in the console; the standard handler is `https://fika-os.firebaseapp.com/__/auth/handler`.
   - Add all six production `hosted.app` backend hostnames to Firebase Authentication's authorized domains. Add the six custom hostnames below after domain mapping and DNS are active.
   - Keep AUTHMOD fail-closed. Enroll/bind production users through the existing production Hub admin workflow; do not import staging UID bindings.

2. **Workspace Drive domain-wide delegation**
   - For service account `fika-prod-workspace-dwd@fika-os.iam.gserviceaccount.com`, enable Google Workspace domain-wide delegation in Google Cloud IAM. Its OAuth client ID is `104667768587124731620`.
   - In Google Admin Console, authorize only `https://www.googleapis.com/auth/drive` for that client.
   - Create/provide a production service-account JSON credential through the approved secure process and create Secret Manager secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` in project `fika-os`. Do not reuse a staging key.
   - Grant the secret only to the production Hub, Hospitality, CPU and Delivered-In runtime identities using the App Hosting secret access grant workflow. Do not grant it to Logistics or Menu Planning.

3. **Production custom domains and DNS**
   - Decide/confirm the hostnames, map them to the matching App Hosting backends, and create the DNS records Firebase provides:
     `hub.fikacatering.com`, `hospitality.fikacatering.com`, `cpu.fikacatering.com`, `menu-planning.fikacatering.com`, `logistics.fikacatering.com`, `delivered-in.fikacatering.com`.
   - DNS currently has no records for these names. Until mapping and DNS are live, browser navigation, OAuth domain authorization, and the shared `.fikacatering.com` session cookie cannot be verified.

## Validation record

The production YAML files parse and each declares `FIKA_RUNTIME_MODE=production`, `FIREBASE_PROJECT_ID=fika-os`, the matching public Firebase project ID, and token references rather than plaintext token values. All six typechecks and production builds passed. Tests: Hub session 13/13, Hospitality 206/206, Menu Planning 220/220, Logistics 449/449; Delivered-In 142/143 with one existing allergen-fixture failure. Broader Hub and CPU suites had failures in untouched areas and were stopped during long-running cases. Final cloud checks confirmed the Hub rules release, renderer revision, three paused jobs, and valid Secret Manager versions with invalid initial versions disabled. `git diff --check` passed. See the task return for suite details and remaining limits.
