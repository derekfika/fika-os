# Production Google identity verification — 2026-10-17

## Results

- Firebase Authentication is initialized for `fika-os` (project number `397503564317`). Google sign-in is enabled. The production handler `https://fika-os.firebaseapp.com/__/auth/handler` returns HTTP 200.
- Authorized domains include the six production hosted.app domains, all six configured custom production hosts, and the existing `fika-os.firebaseapp.com` / `fika-os.web.app` entries.
- Secret Manager contains enabled version 1 of `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON`. Its credential metadata identifies `fika-prod-workspace-dwd@fika-os.iam.gserviceaccount.com`, project `fika-os`, and contains a private-key credential. No credential content is recorded here.
- The production DWD service-account credential successfully obtained a Drive-scoped token through `packages/server-shared/src/drive-owner.ts`. A read-only Drive `about` request delegated as `derek@fikacatering.com` returned HTTP 200 and that delegated user. This proves the DWD credential, Drive scope, and Workspace delegation work for Derek. It does not prove access to any site folder or template.
- Secret-level `roles/secretmanager.secretAccessor` was granted only to the four app runtimes that call Drive code:
  - `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com`
  - `fika-prod-hosp@fika-os.iam.gserviceaccount.com`
  - `fika-prod-cpu@fika-os.iam.gserviceaccount.com`
  - `fika-prod-deliveredin@fika-os.iam.gserviceaccount.com`
- Hospitality Booking is included because its server code calls the shared Drive adapter for menu artifacts and matrix storage (`apps/hospitality-booking/lib/google-menu.ts`, `apps/hospitality-booking/lib/matrix-drive-storage.ts`). It was not included based only on its YAML reference. Menu Planning and Logistics do not call the Drive adapter and have no secret grant.
- The Admin Console's full DWD scope list was not independently readable by the Cloud CLI. The DWD adapter requested only `https://www.googleapis.com/auth/drive`; no Gmail API was tested. The mailer secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER` is absent. Confirm the Admin Console client grant remains Drive-only before cutover.

## Production Drive configuration still required

The production YAMLs contain no `GOOGLE_DRIVE_OWNER_EMAIL_*`, Drive root folder IDs, or app template/output IDs. The shared Drive adapter requires an owner email and DWD credential for hosted DWD access. Production-safe folder/template IDs must be selected from an approved production Workspace location; no evidence establishes staging IDs as environment-independent or safe to reuse. No Drive folders or artifacts were created in this task.

| Scope | Owner identity configuration | Quote folder | Allergen/matrix folder | Menu/template requirements |
|---|---|---|---|---|
| RCoA — OPLOC `oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2` | Required: `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_BE0BECBE_B6CF_4D7F_9C1E_F36E689FEAB2` | Required for group quote: configure booking `googleQuoteFolderId` or `googleDriveFolderId`; the Hub group quote target fails closed without a folder/root. A governed `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<key>` can supply the root where that call path permits it. | Optional site override `googleMatrixFolderId` / `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<key>`; otherwise current code routes to the CPU default Drive owner/folder. Do not assume the fallback until that production folder is approved. | RCoA has no row in `TEMPLATE_FAMILIES`; no RCoA template is currently supported by the Hospitality menu artifact resolver. If RCoA menu artifact publication is launch-critical, a domain-owned template mapping and approved Slides template are required. |
| One Angel Court — OPLOC `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | Required: `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10` | Same group quote requirement as RCoA. | Optional site override; otherwise CPU default owner/folder path as above. | Required when publishing its menu: `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT` or an approved per-site `googleMenuTemplateId` setting. Menu folder may be supplied by `googleMenuFolderId` / generic `googleDriveFolderId`; otherwise the adapter's standard `FIKA OS/Hospitality/Menus` hierarchy is used. |
| MNK — OPLOC `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` | Required: `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F` | Required for quote operations as above. | Optional site override; otherwise CPU default owner/folder path. | Required when publishing its menu: `GOOGLE_MENU_TEMPLATE_ID_MNK` (generic `GOOGLE_MENU_TEMPLATE_ID` is a code fallback) or an approved per-site template setting. Menu folder can use the site setting or standard hierarchy. |
| CPU Production shared workspace | Required: `GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION` | Not applicable. | Configure an approved `GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID` for the shared matrix/release output. If omitted, code resolves the standard `FIKA OS/CPU Production/Production` hierarchy; first artifact publication can create missing folders, so preflight them before enabling writes. | No Slides template; this path stores rendered PDFs. |
| Delivered-In shared workspace | Required: `GOOGLE_DRIVE_OWNER_EMAIL_APP_DELIVERED_IN` | Not applicable. | Configure the approved `GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN` or `GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID`. | Required for menu materialization: `GOOGLE_DELIVERED_IN_TEMPLATE_ID`. The app can create week folders while writing; preflight existing root/template access first. |

Owner emails and folder/template IDs above are mandatory before the corresponding feature is used. Quote folders can be deferred only if quote generation is explicitly out of launch scope. Menu template IDs can be deferred only if menu artifact generation is out of launch scope. Matrix folders can use an approved shared CPU destination, but that fallback owner and folder must be explicitly approved. For unconfigured roots, some artifact paths create standard folders on first write; this task did not exercise those paths or create assets.

Before using site-specific `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<key>` variables, verify the current App Hosting production configuration schema permits these runtime variables. The current production YAMLs do not declare them. Do not add Drive IDs by copying staging config.

## AUTHMOD initial administrator status

Read-only production Firestore check:

- Derek's canonical identity `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7` exists, is active, and has normalized email `derek@fikacatering.com`.
- `fullAccess=false`; no external Firebase UID/provider binding is present.
- No `Administer` grant for this identity was found in `authmodAuthorityGrants`.
- Existing Google/Firebase sign-in can bind the UID on first Hub session through `resolveSessionIdentity` and the governed `bindExternalIdentity` audit path. That binding is not an Administer grant. Production writer freeze means the binding cannot complete until Hub's writer is restored under an approved first-admin procedure.
- No production first-admin bootstrap command exists. This remains the root-of-trust gap for SOL review; no authorization bypass was used.

## Safety readback

- Recursive, read-only Firestore inventory of `fika-os`: **2,259 actual documents, 0 missing-parent placeholders, 10 collections**. This is the approved exact-set count; the previous governed bootstrap record verifies paths/hashes and nine transforms.
- All six application runtime service accounts remain without project-level `roles/datastore.user`; their current project roles are the recorded App Hosting compute role, with Hub's separate Firebase Auth admin role unchanged.
- Recovery Scheduler jobs remain paused: Logistics projection outbox, CPU durable outbox, Menu publication outbox.
- Production YAML email flags remain false; no mailer secret exists. No Gmail API call or email was performed. Reconfirm Google Admin DWD delegation is Drive-only.
- No application deployment, Git push, production Firestore write, Drive write, or staging change occurred.

## OAuth client secret handling

During verification, an unfiltered Auth provider API response included the Google OAuth web-client secret in command output. The secret is not reproduced in this record. Treat it as exposed: rotate the production OAuth web-client secret in Google Cloud/Firebase Console, update the Firebase Google provider to the new secret, then re-read provider config without selecting or printing `clientSecret`. Sign-in remains enabled; verify it after rotation before any rollout. This is a cutover blocker.

## Changelog / validation

Validation was read-only except for the four secret-level accessor IAM bindings above. The DWD preflight used the production secret in process memory and called only Drive `about`; no files were created or changed. Auth configuration, DWD credential identity, secret enabled state, secret IAM, scheduler states, app writer IAM, AUTHMOD identity/grant status, and recursive Firestore count were read back.
