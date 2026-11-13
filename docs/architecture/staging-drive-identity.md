# Hosted staging Drive identity — 13 November 2026

Complexity: High. Recommended model: Sol / High. Reason: Workspace credentials, signed food-safety artifacts and a shared cross-app provider.

## Decision

Use a dedicated staging Workspace user with an ordinary OAuth refresh grant. No DWD credential may be bound to a runtime enabling this mode. Production DWD and explicit local OAuth retain their existing behavior.

| Option | Result |
|---|---|
| Staging Workspace user + user OAuth | Selected. Reuses the approved My Drive staging folder, has storage quota, and cannot choose another Workspace subject. |
| Non-DWD service account + Shared Drive | Supported alternative, but requires a new Shared Drive or moving the approved root; a service account cannot own files in My Drive. More operational change. |
| DWD with a staging subject or folder setting | Rejected. Possession of the issuer key permits other domain subjects within its authorized scopes. A configured folder is not an identity boundary. |

Google references: https://developers.google.com/identity/protocols/oauth2/service-account and https://developers.google.com/workspace/drive/api/guides/about-shareddrives .

## Provider and consumers

`drive-owner` supports an explicit `staging-oauth` mode only after metadata-server project verification, consistent `fika-os-dev` claims, absence of both DWD secrets, user OAuth refresh with exactly Drive scope, immutable Drive user permission-ID/email verification, approved root ACL verification, and denial of 1–10 production sentinel IDs. No DWD/local fallback. The default remains disabled.

All app/OPLOC owners resolve to the staging account/root in this mode. Hospitality matrix destinations and new Hub grouped-quote destinations use the environment staging root rather than production site settings. Explicit menu/quote folder overrides must remain descendants. CPU signed PDF downloads and shared menu templates/results must pass bounded ancestry checks; shortcuts/cycles/outside-root IDs fail. Historical stored artifacts are not migrated or rewritten. Generic stored-link responses and Calendar quote redirects remain blocked in staging: only the CPU signed-document gateway and matrix persistence readiness opt into verified staging operations. This avoids exposing copied production Drive URLs through a user's own browser identity. Hub grouped quote POST remains on its existing containment hold; shared provider support does not enable its notifications or retries.

The user account must have no production group/shared-drive/file access. Root checks and sentinel denials supplement that admin-established account boundary; sample denial does not prove absence of every possible production ACL. An administrator must inspect memberships and actual shares.

No Firestore schema, outbox, publication, signature or production quantity changes. Verification is read-only except the ordinary authorized staging signing workflow. Each verification uses bounded requests: runtime metadata, OAuth refresh, Drive about, root metadata/ACL and up to 10 denial probes; ancestry adds at most 32 metadata reads. No background polling, durable per-read audit writes, or token logging. There is no success cache, so changed ACLs/credentials fail on the next verification.

## Administrator/operator checklist

1. Sign in freshly to Workspace Admin Console. Review client ID `110015458713116745891` (staging Drive issuer) and `101595466827120597596` (separate staging mailer). Record authorized scopes without credentials. Do not alter production clients. A staging DWD grant cannot be restricted to one impersonated user merely by setting an app environment variable.
2. Create/designate one staging-only Workspace user. Remove production group memberships, shared-drive memberships and direct production-file access. Do not use Derek/RCoA/Seven production accounts. Give it storage quota and no admin role.
3. Share ONLY existing `FIKA OS Staging` root `1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z` with that user as writer, keeping Derek's ownership. No public/domain/group grants. Do not move/delete old artifacts or the separate legacy grouped-quote UAT folder. Record the two Drive permission IDs (owner + staging user).
4. Use an internal staging OAuth client and complete ordinary offline user consent as the staging account for `https://www.googleapis.com/auth/drive`. Store `{ "client_id": "...", "client_secret": "...", "refresh_token": "..." }` in a NEW development-project secret, `FIKA_STAGING_DRIVE_OAUTH_JSON`. Do not paste tokens into chat, source, command arguments, logs or PRs. The grant has that account's authority only; it has no DWD assertion/subject or service-account private key.
5. Supply known existing production sentinel file IDs verified readable by the production owner, spanning relevant owner/site boundaries. Only `fields=id` denial probes run as staging; 403 permission denial or 404 is required. Readable sentinels, rate limits, server errors and inconclusive errors fail closed. Do not use non-existent IDs as evidence.
6. After merged-source CI, configure STAGING Hub, CPU and Hospitality only: `FIKA_STAGING_DRIVE_ENABLED=true`, `FIKA_STAGING_DRIVE_EMAIL`, `FIKA_STAGING_DRIVE_PERMISSION_ID`, `FIKA_STAGING_DRIVE_ROOT_ID` (approved root), `FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS` (comma-separated owner+user IDs), `FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS` (comma-separated), and secret `FIKA_STAGING_DRIVE_OAUTH_JSON`. Remove generic and mailer DWD secret bindings from enabled runtimes, including backend overrides; do not only blank one owner variable. Preserve email/Calendar delivery-off gates. Stage mailer work is a separate operation and may remain disabled. Remove/revoke the obsolete staging DWD Drive authority after confirming its consumers; never revoke a production client.
7. Use governed exact-SHA staging deployments for changed apps. Verify actual runtime metadata project, env/secret references, custom-domain auth, source SHA and that no production credential remains. Enabling before provisioning returns unavailable. Production configuration files remain unchanged.
8. Verify positive read/create/same-ID update/readback of a disposable file inside the root; retain sanitized file ID/hash/ACL evidence. Verify negative production probes using the same staging grant. Copy any required menu templates into staging through a separately approved operation; no template reads from production.
9. Two actual authorized staging signers review/sign a disposable no-delivery order through the application. Do not inject signature records or reuse production evidence. Verify existing signed PDF SHA-256, release/source revision, order/OPLOC/date; CPU View/Print must open that artifact on desktop/tablet and unsigned/stale examples must stay unavailable. Then repeat Totals dates/site/service selections and compact/full A4 with authoritative staging quantities.
10. Only after CI and live staging acceptance, deploy the tested CPU merge through `fika deploy cpu --prod --sha <merge> --execute`; verify SHA, ready revision, 100% traffic and read-only existing-order acceptance. Keep #519 open until operational acceptance. No production test writes.

## #368 reconciliation

Current governed workspace rules make historical source leases advisory and permit independently reviewed overlapping worktrees. #368 is draft/conflicting; its old branch is preserved, not absorbed. The referenced deploy marker `e060955d-705c-476b-b785-a74ebcd35582` was checked through `workspace recover-deploy` from the canonical checkout on 13 November: it does not exist, so no recovery mutation was performed. The former shared guard is already in main through #451. This independent PR starts from current main and preserves all old branch/ref/operation evidence. Coordination was posted on #368; no source-ownership reassignment is needed to implement independently.

## Release evidence

Implementation is disabled pending admin provisioning; no Workspace/Drive/IAM/secret mutation, signed fixture, or rollout is claimed by this document. Update the task report with actual CI and live acceptance; never substitute mocks for that gate.
