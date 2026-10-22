# Gallagher dashboard — production release runbook (2026-10-22)

Status: **prerequisites outstanding; nothing deployed to production.** This runbook contains no secret values. Run commands in Git Bash so `printf %s` leaves no trailing newline, and never echo or paste a secret value into chat, tickets or source control.

Production project: `fika-os` (number `397503564317`), region `europe-west4`.

| Backend | Runtime service account | Needs |
| --- | --- | --- |
| `fika-os-prod-hospitality` | `fika-prod-hosp@fika-os.iam.gserviceaccount.com` | all five Gallagher secrets + existing DWD secret |
| `fika-os-prod-hub` | `fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com` | `GALLAGHER_DASHBOARD_BRIDGE_TOKEN` only (same value as Hospitality) |

## 1. Prerequisites (manual)

### 1a. Enable the Sheets API in `fika-os`

Currently only `drive.googleapis.com` is enabled (staging has `sheets.googleapis.com`).

```bash
gcloud services enable sheets.googleapis.com --project fika-os
```

### 1b. Approve the Sheets read-only scope for the production DWD client

The production secret `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` holds `fika-prod-workspace-dwd@fika-os.iam.gserviceaccount.com`, client ID **`104667768587124731620`**.

Google Admin console (super admin) → Security → Access and data control → API controls → Manage Domain Wide Delegation → open client ID `104667768587124731620` → **keep the existing scopes** and add:

```
https://www.googleapis.com/auth/spreadsheets.readonly
```

No Sheets write scope is requested. The impersonated user (section 2) must have at least view access to the legacy "Dashboard Data" spreadsheet.

### 1c. Create the five production secrets

Automatic replication, matching the existing production secrets.

```bash
P=fika-os

# Session signing secret and bridge token: generated and stored without display.
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create GALLAGHER_DASHBOARD_SESSION_SECRET --project $P --replication-policy=automatic --data-file=-
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create GALLAGHER_DASHBOARD_BRIDGE_TOKEN   --project $P --replication-policy=automatic --data-file=-

# Legacy sheet ID and impersonated user: copied from staging (same legacy sheet) without display.
# Confirm with the sheet owner that production should read the same sheet as the same user.
for s in GALLAGHER_LEGACY_SHEET_ID GALLAGHER_SHEETS_IMPERSONATED_USER; do
  gcloud secrets versions access latest --secret=$s --project fika-os-dev | tr -d '\n' \
    | gcloud secrets create $s --project $P --replication-policy=automatic --data-file=-
done

# Customer PIN verifier (a salted scrypt hash, never the PIN). Choose a PIN of at least six digits;
# agree it with Gallagher out of band. The utility prompts without echo and prints only the verifier on its last line.
V=$(node apps/hospitality-booking/scripts/create-gallagher-pin-hash.mjs | tail -n 1)
printf %s "$V" | gcloud secrets create GALLAGHER_DASHBOARD_PIN_HASH --project $P --replication-policy=automatic --data-file=-
unset V
```

### 1d. Grant runtime access

```bash
P=fika-os
for s in GALLAGHER_DASHBOARD_PIN_HASH GALLAGHER_DASHBOARD_SESSION_SECRET GALLAGHER_DASHBOARD_BRIDGE_TOKEN GALLAGHER_LEGACY_SHEET_ID GALLAGHER_SHEETS_IMPERSONATED_USER; do
  firebase apphosting:secrets:grantaccess $s --backend fika-os-prod-hospitality --project $P
done
firebase apphosting:secrets:grantaccess GALLAGHER_DASHBOARD_BRIDGE_TOKEN --backend fika-os-prod-hub --project $P
```

If `grantaccess` is unavailable, bind manually (accessor + viewer, the existing DWD secret pattern):

```bash
gcloud secrets add-iam-policy-binding NAME --project fika-os --member serviceAccount:fika-prod-hosp@fika-os.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding NAME --project fika-os --member serviceAccount:fika-prod-hosp@fika-os.iam.gserviceaccount.com --role roles/secretmanager.viewer
# bridge token additionally for serviceAccount:fika-os-prod-hub-runtime@fika-os.iam.gserviceaccount.com
```

## 2. Read-only verification (safe to run any time; prints no values)

```bash
gcloud secrets list --project fika-os --filter="name~GALLAGHER" --format="value(name.basename())"          # expect 5 names
for s in GALLAGHER_DASHBOARD_PIN_HASH GALLAGHER_DASHBOARD_SESSION_SECRET GALLAGHER_DASHBOARD_BRIDGE_TOKEN GALLAGHER_LEGACY_SHEET_ID GALLAGHER_SHEETS_IMPERSONATED_USER; do
  gcloud secrets versions list $s --project fika-os --format="value(name.basename(),state)"; done              # one enabled version each
gcloud services list --enabled --project fika-os --filter="name:sheets.googleapis.com" --format="value(name)" # expect one line
# Bridge parity (compares hashes, prints nothing secret):
A=$(gcloud secrets versions access latest --secret=GALLAGHER_DASHBOARD_BRIDGE_TOKEN --project fika-os | sha256sum | cut -c1-12); echo "bridge token fingerprint $A"
```

The manifests already reference identical secret names in staging and production (`apphosting.production.yaml` in both apps). Both backends read the single secret `GALLAGHER_DASHBOARD_BRIDGE_TOKEN`, so the Hub and Hospitality always share one value. Hospitality's production `FIKA_HUB_BASE_URL` is `https://fika-os-prod-hub--fika-os.europe-west4.hosted.app`.

## 3. Integration into `main` (after prerequisites)

1. **Resolve the Hub fix first.** Production Hub currently serves `2efb5a59` (`Hub: do not invent a 00:00 delivery window for Menu Planning orders`, branch `claude/hub-menu-window-fix`), which is **not on `origin/main`**. A Hub rollout built from the Gallagher branch alone would silently remove that fix. Land that commit on `main` first (or confirm it is superseded), then rebase/merge the Gallagher branch onto it. The only expected conflict is `CHANGELOG.md`.
2. `git fetch origin`; record `origin/main`. Merge `claude/gallagher-dashboard-recovery-eed36f` (fast-forward after the rebase); no unrelated Logistics files are touched (the branch changes only `apps/hospitality-booking`, `apps/integration-hub` and `CHANGELOG.md`). Local-only Logistics commits that are not on `origin/main` must not be included.
3. Re-run: Hospitality `npm test`, `npx tsc --noEmit`, `npm run build`; Hub `npx tsc --noEmit` and `npx tsx --test tests/gallagher-bookings-route.test.ts`.
4. Push `main`, record the exact SHA.

## 4. Production rollouts (exact SHA, Hub first)

```bash
SHA=$(git rev-parse HEAD)   # the validated main SHA
firebase apphosting:rollouts:create fika-os-prod-hub        --project fika-os --git-commit $SHA --force
firebase apphosting:rollouts:create fika-os-prod-hospitality --project fika-os --git-commit $SHA --force
```

Record both build IDs. Hub first so the bridge exists before Hospitality calls it.

## 5. Authenticated production UAT

Public URL: `https://fika-os-prod-hospitality--fika-os.europe-west4.hosted.app/angel-court/gallagher`

- Anonymous `GET /angel-court/gallagher/data` → 401; wrong PIN → 401; page returns 200 with `noindex`.
- Hub `GET /api/gallagher-bookings` with no or a wrong `x-fika-gallagher-bridge-token` → 401.
- Sign in with the customer PIN; confirm the Sheets read succeeds (200, bookings listed, none cancelled shown as upcoming), the booking count is in line with staging (91 at 2026-10-22, plus any newer bookings), and the Sheet is read with the read-only scope only.
- Desktop and 375 px: tabs, search, filters, details drawer, Lock, 401 after Lock.
- Do not send emails, alter bookings or migrate records.

## 6. Rollback

- The feature is additive and read-only; no data is written.
- Fast rollback: create a rollout of the previous exact SHAs — Hospitality `2dbd8a82d558…` (`build-2026-10-21-001`) and Hub `2efb5a5904ad…` (`build-2026-10-22-001`):
  `firebase apphosting:rollouts:create <backend> --project fika-os --git-commit <full previous SHA> --force`
  (resolve the full SHAs with `git rev-parse 2dbd8a82d558 2efb5a5904ad`).
- Emergency customer lock-out without redeploying: disable the PIN verifier secret version (`gcloud secrets versions disable <n> --secret GALLAGHER_DASHBOARD_PIN_HASH --project fika-os`) and roll out/restart so the runtime reads no valid verifier (the dashboard then answers 503); rotating `GALLAGHER_DASHBOARD_SESSION_SECRET` invalidates all existing sessions.

## 7. Rotation

- PIN: create a new verifier version, roll out, confirm the old PIN returns 401.
- Bridge token: add a new version of the single secret and roll out both backends together.
