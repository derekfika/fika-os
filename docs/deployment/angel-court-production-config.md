# Angel Court production configuration preparation

Target release candidate: `release/production-final-2` at `30ddf76cf70a49f8b5b2ed1fe9a36cf94e9df9bc`.

The canonical Angel Court OPLOC is `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` (One Angel Court). It is present in the governed OPLOC registry, the current Hub/source mapping and the site menu format registry. Production values are keyed by that stable ID.

## App Hosting values prepared

The Hospitality Booking production config binds `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10` to `seven@fikacatering.com` and `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT` to the approved Hospitality tablet presentation.

The Delivered-In production config binds the same OPLOC owner, `GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10` to `1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc`, and `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT` to its separate approved tablet presentation. The existing site format registry offers only `tablet` for Angel Court; flat and tent labels remain unavailable.

The Hub production sender map includes From, Reply-To and authenticated account `seven@fikacatering.com`, with display name `One Angel Court Hospitality` and the existing four lifecycle kinds. `verifiedSendAs` remains `false` until the Workspace owner confirms the identity. The global `FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED` switch remains `false`.

No `GOOGLE_DRIVE_ROOT_FOLDER_ID` is needed when the three explicit destination folders are configured. The `googleDriveFolderId` root fallback remains unset.

## Persisted dashboard settings still to apply

The folder fields are owned by the existing Hub dashboard settings document `fikaDashboardQuoteSettings/angel-court-hospitality`. Save these values through the authorized Hospitality dashboard settings workflow:

```text
googleMenuFolderId = 1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc
googleMatrixFolderId = 1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X
googleQuoteFolderId = 18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO
```

These settings were not written from this task because no authenticated production dashboard session was available. No existing production setting was read or overwritten. No production Firestore mutation was made.

## Manual Workspace checks

The code impersonates the configured Drive owner through the existing `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` secret and requests the Drive scope `https://www.googleapis.com/auth/drive`. Verify that the production DWD client is authorized for this scope, the Drive and Slides APIs are enabled, and `seven@fikacatering.com` can create output in the menu, matrix and quote folders and use both supplied Slides templates. The connected Drive metadata reads returned 404 for all five IDs, so this task could not verify their existence or Seven's permissions. No sharing was changed.

The Gmail sender is prepared but cannot send until the Workspace owner verifies that `seven@fikacatering.com` is a valid Send As identity for the authenticated mailbox. The separate mailer DWD secret and Gmail send scope are not enabled by this change.

## Site notification recipient

The legacy Angel Court config identifies `seven@fikacatering.com` as `siteEmailAddress`, but its `notificationRecipients` list is empty; the current legacy notification implementation addresses the booking contact. This does not establish Seven as the internal site-team notification recipient. `FIKA_ANGEL_COURT_NOTIFICATION_RECIPIENTS` remains unset pending business confirmation.
