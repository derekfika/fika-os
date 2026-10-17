# Production Drive launch preflight — 2026-10-17

## OAuth / Firebase Auth

- Production Firebase project config: `projects/397503564317/config` (`fika-os`).
- `google.com` provider is enabled and has a production-project OAuth client ID. The provider response was field-masked to exclude `clientSecret`; no OAuth secret was read or recorded in this verification.
- The production handler returned HTTP 200. All required hosted and custom production domains are authorized.
- This verifies provider configuration and callback reachability, not an interactive Google login. The old OAuth secret's invalidation cannot be established from the safe provider fields: Google does not expose the client-secret generation/revocation state in this API response. Derek must confirm the credential was rotated and the Firebase provider was saved with the replacement. Do not read or print the secret to verify this.

## Read-only Drive results

Checks used the production `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` in process memory, `packages/server-shared/src/drive-owner.ts`, and Drive-only scope. They called only Drive `about` and `files.get`; no Drive write endpoint was called.

**RCoA owner `rcoa@fikacatering.com`: delegated Drive identity matched; status PASS.**

| Asset | ID | Result |
|---|---|---|
| Quotes folder | `1SMd9V_3wTwLAKpXJxj0VacDosRsJBFKR` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |
| Allergens folder | `1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |
| Menus folder | `1dEY_-fr_MD1iZmIZ0hfzaDcBhpFPz1Ij` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |

RCoA menu generation remains DEFERRED because the repository has no approved RCoA menu-template mapping.

**One Angel Court owner `seven@fikacatering.com`: delegated Drive identity matched; status PASS.**

| Asset | ID | Result |
|---|---|---|
| Quotes folder | `18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |
| Allergens folder | `1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |
| Menus folder | `1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc` | PASS — HTTP 200, folder, not trashed, `canAddChildren=true` |
| Tablet menu template | `1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw` | PASS — HTTP 200, Google Slides presentation, not trashed, `canCopy=true` |
| Flat template (deferred) | `1Uh1WSJvZk3fPaIFh-36Jwl9GYC5omuwiHCeJkbWC2T8` | PASS — HTTP 200, Google Slides presentation, not trashed, `canCopy=true`; remains deferred |
| Tent template (deferred) | `13ceJl5oqKmn-138GMOg5bPCVhqQV4r3Y4kyq28bkjx0` | PASS — HTTP 200, Google Slides presentation, not trashed, `canCopy=true`; remains deferred |

## Configuration applied locally

Added the following non-secret, approved production values to App Hosting source configuration (not deployed):

- Integration Hub: RCoA and One Angel Court OPLOC owner emails and quote-folder IDs as `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<key>` and `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<key>`. Hub's only direct Drive path is the Hospitality group quote artifact path, so using each approved Quotes folder as that app's owner root is operation-specific and safe.
- Hospitality Booking: approved One Angel Court tablet template ID as `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT`.

The YAML files parse. Existing secret-level DWD access remains limited to Hub, Hospitality Booking, CPU Production, and Delivered-In. No OAuth secret or DWD credential was added to repository files.

RCoA/Angel Court Allergens and Menus folder IDs are **verified but not wired**. Hospitality Booking currently resolves quote/menu/matrix folder IDs from per-dashboard `fikaDashboardQuoteSettings` fields (`googleQuoteFolderId`, `googleMenuFolderId`, `googleMatrixFolderId`). Target production settings documents for `rcoa-hospitality`, `angel-court-hospitality`, and `mnk-hospitality` are absent. Writing those settings would mutate production Firestore, which was prohibited. The generic OPLOC root environment variable is shared by operations in Hospitality Booking; assigning one of the three distinct folders as that root could route another artifact type into the wrong folder. Therefore no Hospitality OPLOC root was set. Production remains fail-closed for those operations until a separately authorized, governed settings write/configuration path is provided.

## MNK / CPU / Delivered-In classification

| Area | Known and safe | Deferred | Derek input still required |
|---|---|---|---|
| MNK | OPLOC `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`; supported key `GOOGLE_MENU_TEMPLATE_ID_MNK` (fallback `GOOGLE_MENU_TEMPLATE_ID`) | Menu/quote output can be deferred if outside launch; no production values set | Approved Workspace owner email, production menu template ID, and folder/settings IDs. Staging `mnk@...` is not copied or treated as production approval. |
| CPU shared workspace | Supported keys `GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION`, `GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID` | A default `FIKA OS/CPU Production/Production` folder hierarchy can be resolved by code, but may create folders on a later write, so it is not used as a preflight substitute | Confirm production delegated owner and approved CPU output folder. Staging Derek owner value is not promoted automatically. |
| Delivered-In shared workspace | Supported keys `GOOGLE_DRIVE_OWNER_EMAIL_APP_DELIVERED_IN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN` or `GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID`, and `GOOGLE_DELIVERED_IN_TEMPLATE_ID` | Can defer only if Delivered-In menu artifact generation is outside launch | Approved owner, output root, and Slides template ID. No IDs are invented. |

## Safety readback

- Production Firestore recursive inventory: 2,259 actual documents, zero placeholders, 10 collections. No Firestore write occurred.
- All six App Hosting runtime identities remain without project-level `roles/datastore.user`.
- All three recovery Scheduler jobs remain PAUSED.
- Production Hub/Hospitality email flags remain false; mailer secret is absent. No Gmail API was called. The DWD adapter requested only the Drive scope; confirm the Workspace Admin allowlist remains Drive-only.
- DWD secret IAM is secret-level and contains only the four Drive-using runtime identities listed above.
- No Drive folder/file mutation, application deployment, Git push, or staging change occurred.

## Changelog and validation

Validation: field-masked Firebase provider/domain readback, auth-handler HEAD check, Drive DWD preflight for all listed folders/templates, production YAML parse/readback, secret IAM policy readback, six-runtime Firestore role readback, Scheduler readback, and recursive production Firestore inventory. No app tests were needed for the YAML-only change.
