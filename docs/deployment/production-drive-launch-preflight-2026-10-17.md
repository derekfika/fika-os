# Production Drive launch preflight — 2026-10-17

## OAuth / Firebase Auth

- Production Firebase project config: `projects/397503564317/config` (`fika-os`).
- `google.com` provider is enabled and has a production-project OAuth client ID. The provider response was field-masked to exclude `clientSecret`; no OAuth secret was read or recorded in this verification.
- The production handler returned HTTP 200. All required hosted and custom production domains are authorized.
- This verifies provider configuration and callback reachability, not an interactive Google login. The old OAuth secret's invalidation cannot be established from the safe provider fields: Google does not expose the client-secret generation/revocation state in this API response. Derek has directed that rotation be completed after cutover; track it below and do not read or print either secret to verify it.

### Post-cutover security task

- [ ] Rotate the production OAuth web-client secret, update the Firebase Google provider with the replacement, and verify provider/callback operation using secret-safe readback. This is explicitly deferred until after application cutover by Derek. Never read the old or replacement secret into logs or repository files.

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

## Live Drive routing recheck — 2026-10-17

The approved operational Drive assets were rechecked using the production DWD secret in process memory and the Drive-only scope `https://www.googleapis.com/auth/drive`. The delegated identities matched `rcoa@fikacatering.com` and `seven@fikacatering.com`. All six approved folders were untrashed Drive folders with `canAddChildren=true` and ownership matching the delegated identity. The approved One Angel Court tablet template was an untrashed Google Slides presentation with `canCopy=true`. No Drive write endpoint was called. Deferred flat/tent templates and any other Drive assets were not rechecked or enabled.

The exact production settings documents are still absent:

| Dashboard | Firestore path | Before state | Proposed routing fields |
|---|---|---|---|
| RCoA (`rcoa-hospitality`) | `fikaDashboardQuoteSettings/f43545c4a4a76ad4b151a36c0e0a2f865542cb913830c389c31426b59312bbca` | Document absent; Hub resolves the existing RCoA code defaults (version 1) | `googleQuoteFolderId=1SMd9V_3wTwLAKpXJxj0VacDosRsJBFKR`; `googleMatrixFolderId=1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X`; `googleMenuFolderId=1dEY_-fr_MD1iZmIZ0hfzaDcBhpFPz1Ij`; no menu template |
| One Angel Court (`angel-court-hospitality`) | `fikaDashboardQuoteSettings/c41775be78cd0b323322ed9a111db9d8565b4fa6b08f34e69937410b7bc5ba12` | Document absent; Hub resolves the existing Angel Court code defaults (version 1) | `googleQuoteFolderId=18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO`; `googleMatrixFolderId=1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X`; `googleMenuFolderId=1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc`; `googleMenuTemplateId=1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw` |

The exact effective before-state defaults, from `defaultDashboardQuoteSettings`, are:

- RCoA: `version=1`; management fee `{mode: fixed, value: 0, label: Management fee}`; delivery charge `{enabled: true, amount: 35, label: CPU delivery charge}`; labour roles `[chef, FOH Assistant, KP]`; `vatRate=0.2`; no `buildingCharges`.
- One Angel Court: `version=1`; management fee `{mode: percentage, value: 8, label: Angel Court management fee}`; the same delivery charge and labour roles; building charges enabled with housekeeping `23.68/hour`, security `29.95/hour` and `8` minimum hours, aircon `200` after hour `19`, and venue hire disabled with amount `1000`; `vatRate=0.2`.

The proposed create state is exactly those per-dashboard defaults with only the routing fields in the table added, `version=2`, and `updatedAt`/`updatedBy` set by the existing service at execution time (the actor would be Derek's existing bound production identity; the UID is intentionally not repeated here). No `googleDriveFolderId` generic root is proposed. The RCoA template remains unset. This is a preview only; no settings field was written.

No production Firestore settings mutation was made. The Hub owns these settings and the existing write path is `POST /api/hospitality-bookings` with `action=save-quote-settings`; it requires an authenticated Hub administrator and uses the existing `saveDashboardQuoteSettings` transaction. Derek signed in to the production launcher in the Codex in-app browser, which displayed his existing Integration Administrator session. The production `/hub` route nevertheless continued to present its Google sign-in gate and exposed no dashboard-settings form or save action. The production Hospitality UI that calls this route is not deployed (both its custom and hosted URLs returned HTTP 404). Derek's human gcloud identity cannot impersonate the Hub runtime because it has no `roles/iam.serviceAccountTokenCreator` binding on that service account. No new IAM grant was added and no direct human-principal Firestore write was substituted for the governed route.

If the existing route is later invoked through an approved authenticated operator UI, it will materialize each dashboard's code defaults unchanged, add only the routing fields above, set version 2, and set `updatedAt`/`updatedBy` through the existing service. Expected Firestore mutation count is two document creates. Current count remains zero. RCoA menu output remains fail-closed without a template; MNK's template/output remains deferred; no generic root is used in place of the distinct per-dashboard destinations.

Current safety readback: Hub runtime retains `roles/datastore.user`; Menu, CPU, Hospitality, Logistics, and Delivered-In do not. The three recovery jobs remain PAUSED. No mailer/email/Gmail-named Secret Manager secret was found; Hub and Hospitality production config keep `FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED=false`. The DWD secret-level accessor set remains Hub, CPU, Hospitality, and Delivered-In only; no Menu or Logistics runtime access was added. No app deployment, Git push, AUTHMOD mutation, or staging mutation occurred.

### Current Drive-specific cutover classification

| App | Drive-dependent path | Current classification |
|---|---|---|
| Menu Planning | No Drive requirement in the production config; menu packages use the approved package path | READY from the Drive gate |
| CPU Production | Signed allergen matrix Drive materialization requires DWD plus a configured CPU owner; production owner/output root is absent | Base app READY; Drive materialization deferred/fail-closed |
| Hospitality Booking | RCoA and One Angel Court require distinct dashboard folder settings; Angel Court tablet requires the approved Slides template | BLOCKED for the requested routing until the two settings documents are created; RCoA menu template and MNK remain deferred |
| Logistics | No Drive requirement in the production config | READY from the Drive gate |
| Delivered-In | Site menu document generation requires configured owner, output folder, and template; none is approved in production | Base app READY; document generation deferred/fail-closed |

## Governed Hospitality Drive settings write — 2026-10-17

The two approved production dashboard settings records were created after confirming both target documents and the deterministic audit receipt were absent. The write used Derek's active `derek@fikacatering.com` gcloud identity, matched to the already bound production AUTHMOD identity `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7` and its production Firebase UID. No staging identity data or settings were read into the write plan. The production-only command is dry-run by default and refuses any non-Derek account, existing target, invalid identity binding, changed `fullAccess`, or unapproved folder/template combination.

The schema is the existing `DashboardQuoteSettings` contract in `apps/integration-hub/lib/quote-engine.ts`, stored in `fikaDashboardQuoteSettings`. Equivalent staging records were read only to compare field names and metadata/version shape; their Drive IDs, timestamps, and actors were not used or recorded. The reader derives `rcoa-hospitality` from site `rcoa`, and maps `angel-court` to `angel-court-hospitality`; each is read by the SHA-256 of its dashboard ID. The service defaults were preserved, `version` advanced from 1 to 2, and the authenticated actor's Firebase UID plus one consistent operation timestamp were set. Each folder category remains a distinct per-dashboard field; no generic Drive root was added.

RCoA, path `fikaDashboardQuoteSettings/f43545c4a4a76ad4b151a36c0e0a2f865542cb913830c389c31426b59312bbca`, exact created body:

```json
{
  "dashboardId": "rcoa-hospitality",
  "version": 2,
  "managementFee": { "mode": "fixed", "value": 0, "label": "Management fee" },
  "deliveryCharge": { "enabled": true, "amount": 35, "label": "CPU delivery charge" },
  "labourRates": [
    { "id": "chef", "label": "Chef" },
    { "id": "foh-assistant", "label": "FOH Assistant" },
    { "id": "kp", "label": "KP" }
  ],
  "vatRate": 0.2,
  "updatedBy": "BsBKmmAxZPckT7aP7tKtUVgDNg92",
  "googleQuoteFolderId": "1SMd9V_3wTwLAKpXJxj0VacDosRsJBFKR",
  "googleMatrixFolderId": "1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X",
  "googleMenuFolderId": "1dEY_-fr_MD1iZmIZ0hfzaDcBhpFPz1Ij",
  "updatedAt": "2026-10-17T18:56:37.804Z"
}
```

One Angel Court, path `fikaDashboardQuoteSettings/c41775be78cd0b323322ed9a111db9d8565b4fa6b08f34e69937410b7bc5ba12`, exact created body:

```json
{
  "dashboardId": "angel-court-hospitality",
  "version": 2,
  "managementFee": { "mode": "percentage", "value": 8, "label": "Angel Court management fee" },
  "deliveryCharge": { "enabled": true, "amount": 35, "label": "CPU delivery charge" },
  "buildingCharges": {
    "enabled": true,
    "housekeeping": { "hourly": 23.68, "label": "Housekeeping" },
    "security": { "hourly": 29.95, "minimumHours": 8, "label": "Security" },
    "aircon": { "hourly": 200, "afterHour": 19, "label": "Aircon after 7pm" },
    "venueHire": { "enabled": false, "amount": 1000, "label": "Venue hire" }
  },
  "labourRates": [
    { "id": "chef", "label": "Chef" },
    { "id": "foh-assistant", "label": "FOH Assistant" },
    { "id": "kp", "label": "KP" }
  ],
  "vatRate": 0.2,
  "updatedBy": "BsBKmmAxZPckT7aP7tKtUVgDNg92",
  "googleQuoteFolderId": "18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO",
  "googleMatrixFolderId": "1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X",
  "googleMenuFolderId": "1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc",
  "googleMenuTemplateId": "1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw",
  "updatedAt": "2026-10-17T18:56:37.804Z"
}
```

One receipt was written in the same atomic Firestore commit at `integrationHubGovernanceAudit/hospitality-drive-settings-747ef0aa3721a6cabf0e853ea8e24dc52058476f6db61862a1e28d5bbd7b91e8`, action `Hospitality dashboard Drive settings created`, actor Derek Buckley. Total: two settings documents plus one governance receipt, three Firestore document writes in one create-only commit. The script then read all three records back and verified exact body equality. Both settings were subsequently confirmed to be read at their existing deterministic paths; the deployed reader has no staging fallback and falls back only to its in-code defaults if a dashboard document is absent.

Post-write read-only Drive checks used the production DWD credential with only `https://www.googleapis.com/auth/drive`: all six configured folders remain owned by their delegated owner, untrashed folders with `canAddChildren=true`; the One Angel Court tablet asset remains an untrashed Google Slides presentation owned by the delegated owner with `canCopy=true`. No Drive write was made. RCoA menu generation remains deferred (no approved template mapping); Angel Court flat/tent templates remain absent/deferred.

### Updated Drive-specific cutover classification

| App | Drive gate status | Boundary |
|---|---|---|
| Integration Hub | READY for this Drive gate | Approved RCoA and Angel Court group-quote roots are already configured; Hub writer remains active. |
| Hospitality Booking | READY for configured RCoA/Angel Court routing | Quote, allergen, and menu folders resolve per dashboard. RCoA menu generation and Angel Court flat/tent templates remain deferred/fail-closed. |
| Menu Planning | READY for base/package path | No Drive-specific requirement; assess other cutover gates separately. |
| CPU Production | READY for base app; allergen-matrix Drive materialization DEFERRED | No approved production CPU owner/output root was supplied; signed matrix routing remains fail-closed. |
| Delivered-In | READY for base app; site-menu document generation DEFERRED | No approved production owner/output/template was supplied; only that document feature remains deferred. |
| Logistics | READY for this Drive gate | No Drive requirement in production config; assess other cutover gates separately. |

Safety readback after the commit: Hub retains its existing Firestore writer; Menu, CPU, Hospitality, Logistics, and Delivered-In remain without `roles/datastore.user`. All three recovery jobs remain PAUSED; production email flags remain false; no mailer secret was found. This operation touched only the two approved settings documents and one governance receipt: AUTHMOD policy, staging, Drive content, application deployments, and other app writers were unchanged.

The live AUTHMOD readback confirmed Derek's active organisation-scoped `integration-hub`/`authmod` `Administer` grant, the same effective authority used by the governed settings route's `canonical.edit` check. The committed CLI now also requires that grant before any future apply. Validation performed: one-off CLI dry-run and production create-only apply/read-back; staging field-shape comparison only; Drive DWD read-only metadata preflight; project writer/Scheduler/email readback; `node --check` for the CLI; 17 focused quote-engine tests; `git diff --check`. No app was deployed and nothing was pushed.
