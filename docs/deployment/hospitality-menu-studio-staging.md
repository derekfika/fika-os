# Hospitality Menu Studio staging

Studio's first staging slice is a read-only preview with its own AUTHMOD admission and data boundary. The proposed target below is reserved in source for provisioning checks. It is excluded from release, rollback, bootstrap, protection and hosted-runner target selection. App Hosting has a closed default runtime while the reviewed enablement is pending. Cloud writes, signing, publication, collection activation and operational UAT require independent acceptance.

| Setting | Proposed value |
| --- | --- |
| Governed app key | `menu-studio` |
| Firebase project and App Hosting region | `fika-os-dev` / `europe-west4` |
| App Hosting backend, environment and root | `fika-menu-studio-staging` / `staging` / `apps/hospitality-menu-studio` |
| Source | `derekfika/fika-os` through the staging project GitHub connection |
| Runtime service account | `fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com` |
| Studio Firestore | Named database `hospitality-menu-studio` in `fika-os-dev` |
| Browser origin and authority | `https://menu-studio-staging.fikacatering.com/` and `https://staging-os.fikacatering.com/` |
| Storage and Google Workspace | No bucket, secret, Workspace or downstream integration binding for the first preview |
| Production | No Studio backend or release mapping |

## Read-only preflight

From the checkout containing this runbook, use the existing authorised local Google Cloud identity.

```powershell
npm run fika -- studio-preflight --staging
```

The command inspects the exact staging App Hosting backend, any environment overrides, the automatic rollout and traffic settings, the custom-domain linkage, the dedicated service account and the named database metadata. It prints only the proposed target, evidence statuses and open gates. `MISSING` means the App Hosting API returned a 404. `MISMATCH` indicates observed conflicting settings. `UNVERIFIED` covers unreadable, unavailable or unconfirmed evidence. The overall result remains `BLOCKED` with a nonzero exit even when every resource is present, until reviewed release enablement. The command reads metadata only and requires no hosted identity, live app session, document read, deployment or cloud mutation.

On 18 November 2026, read-only Firebase backend inventories showed no Studio target in staging or production. The proposed service account returned `NOT_FOUND`, the staging Firestore inventory showed only `(default)`, and the proposed hostname yielded no A record in the local lookup. There is no Studio serving SHA to verify. The AUTHMOD round trip and operational UAT are blocked.

## Provisioning and verification gates

1. **Backend and identity.** With separate owner authorisation, provision only the staging target and dedicated user-managed runtime identity. Disable automatic rollouts at creation, skip the initial build, and verify the linked repository and root. Leave backend environment overrides empty. Inspect the effective build and runtime service accounts and environment on the eventual serving revision. Keep runtime credentials separate from the existing deployment operator and grant no new hosted release identity for this slice. [App Hosting backend configuration](https://firebase.google.com/docs/app-hosting/configure)
2. **Firestore and credentials.** Wire Studio's server-side Admin SDK explicitly to the named staging database before allowing an App Hosting rollout. The current store opens the default database. Keep cloud writes closed and limit the preview runtime to named-database reads with resource-scoped least privilege. Review effective IAM for both build and runtime principals, including inherited, group and conditional grants and impersonation paths. Record denied access to the staging default database, production Firestore, buckets, secrets and infrastructure. A missing or unreadable policy result leaves the gate blocked. Keep security rules closed to client access. [Firestore database access](https://docs.cloud.google.com/firestore/native/docs/manage-databases), [effective IAM troubleshooting](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)
3. **AUTHMOD and custom domain.** Obtain owner authorisation for the exact staging DNS and App Hosting domain records and the Hub registration. Register `hospitality-menu-studio` as its own AUTHMOD app, use explicit Studio capabilities and configure the exact approved stage return origin. The current foundation asks Hub for legacy Rotation permissions, which cannot grant Studio access. Use a current-only authority read that fails closed on missing or stale evidence, including a missing access package. Confirm permitted-view, denied, expired-session and wrong-origin behaviour through the custom-domain authentication round trip. Bind any real test actor or reviewer only under separately approved staging grants.
4. **Storage and side effects.** Verify that the runtime has no effective bucket access, production secrets, service-account keys, Workspace delegation, Drive ACLs, Calendar or mail scopes, notification integrations, scheduler/job triggers or downstream append/write permissions for this preview. Confirm runtime calls stay within the staging Hub and named database, including recovery and failure paths. Future package or export storage needs a separately reviewed staging-only bucket, scoped IAM and source/hash verification. Future Workspace use requires separate credentials and exact isolated Drive ACLs. [#181 staging isolation requirements](https://github.com/derekfika/fika-os/issues/181)
5. **Release and acceptance.** Submit a separately reviewed source change for active staging mapping, exact first-release verification and read-only smoke of build identity and unauthenticated API denial. Run the preflight and preserve the operator's effective IAM, AUTHMOD, side-effect and runtime binding evidence in the staging record. Once authorised, use the governed exact-main release CLI and verify Firebase traffic plus exact build identity through the custom domain. An owner-authorised authenticated session and verified isolation are prerequisites for staging UAT. Draft writes, data refresh/import, real allergen signing and publication each require their own authorised scope and evidence. [Release workflow](workflow.md), [Studio source and cutover ADR](../architecture/hospitality-menu-studio.md)
