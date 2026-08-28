# Hospitality and CPU Google Drive ownership

Hosted Hospitality Drive writes are performed with Google Workspace Domain-Wide Delegation (DWD). The service account impersonates a governed Workspace identity; it never impersonates the signed-in human and it never accepts an owner or folder identity from the browser. Local development may use the existing OAuth refresh-token flow only when `FIKA_RUNTIME_MODE=local`.

## Ownership boundary

- Hospitality quote and menu artifacts resolve the booking from Integration Hub by `canonicalId`, then use the stored `booking.service.oplocId` as the owner.
- CPU production matrices use the distinct `app-workspace` owner `cpu-production`, regardless of delivery destination.
- Existing configured quote/menu folders remain valid folder roots. When no folder override exists, the adapter idempotently resolves `FIKA OS / Hospitality|CPU Production / Quotes|Menus|Production`, then a `WC_YYYY-MM-DD` folder when a week is supplied.
- Existing bookings and historical Drive files are not moved or rewritten.

## Staging configuration

Configure these in Firebase App Hosting / Secret Manager for project `fika-os-dev`; do not commit values or private keys:

```text
GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON
GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F
GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION
```

Optional owner-specific root folders use the matching `GOOGLE_DRIVE_ROOT_FOLDER_ID_*` key. Existing per-site quote/menu folder settings remain server-resolved. `GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID` may explicitly select the CPU production folder.

The canonical MNK OPLOC is `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`. Configure an owner identity for each canonical OPLOC returned by the Integration Hub Connections/OPLOC registry for MNK, Angel Court, CFC and Munich Re; do not derive those IDs from display labels.

## Google Admin setup

Create a dedicated service account, enable Domain-Wide Delegation, and authorize only the Drive scope required by this adapter (`https://www.googleapis.com/auth/drive`) for the staging service account. Permit impersonation only of the governed site identities and the CPU production identity. Store the resulting service-account JSON as the App Hosting secret. Do not configure personal OAuth credentials in hosted staging, and do not copy staging values to production as part of this change.

If an owner identity or DWD secret is missing in hosted mode, the adapter fails closed with a configuration error. It does not fall back to a human account or grant access to another OPLOC.
