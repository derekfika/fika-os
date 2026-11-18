# Hospitality Menu Studio staging

Studio's first staging slice is a read-only preview with its own AUTHMOD admission and data boundary. The existing backend is reserved in source for provisioning checks and excluded from normal release, rollback, bootstrap and hosted-runner target selection. The default App Hosting runtime stays closed. The staging overlay pins a named database and a View-only Hub authority. Signing, publication, collection activation and other operational tests need separate approval.

| Setting | Proposed value |
| --- | --- |
| Governed app key | `menu-studio` |
| Firebase project and App Hosting region | `fika-os-dev` / `europe-west4` |
| App Hosting backend, environment and root | `fika-menu-studio-staging` / `staging` / `apps/hospitality-menu-studio` |
| Source | `derekfika/fika-os`, branch `main`, through the staging project GitHub connection |
| Runtime service account | `fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com` |
| Studio Firestore | `hospitality-menu-studio` in `fika-os-dev`. Proposed Standard Native database in `europe-west4` with deletion protection |
| Browser origin and authority | `https://menu-studio-staging.fikacatering.com/` and `https://staging-os.fikacatering.com/` |
| Storage and Google Workspace | No application data bucket, secret, Workspace or downstream integration binding for the first preview |
| Production | No Studio backend or release mapping |

## Read-only preflight

From the checkout containing this runbook, use the existing authorised local Google Cloud identity.

```powershell
npm run fika -- studio-preflight --staging
```

The command inspects the exact staging App Hosting backend, any environment overrides, the configured branch, automatic rollout and traffic settings, the custom-domain linkage, the dedicated service account and the named database metadata. It prints only the proposed target, evidence statuses and open gates. `MISSING` means the cloud service explicitly reported that the resource does not exist. `MISMATCH` indicates observed conflicting settings. `UNVERIFIED` covers unreadable, unavailable or unconfirmed evidence. The overall result remains `BLOCKED` with a nonzero exit even when every resource is present, until reviewed release enablement. The command reads metadata only and requires no hosted identity, live app session, document read, deployment or cloud mutation.

On 18 November 2026, read-only Firebase metadata showed the staging backend linked to the expected repository and root on `main`, with automatic rollouts disabled and no current or target traffic. Its environment name was unset and it used the default App Hosting compute identity. The proposed dedicated service account and named database returned `NOT_FOUND`. The custom domain was registered in App Hosting, with ownership missing, the host unhosted and the certificate validating. There is no Studio serving SHA to verify. The AUTHMOD round trip and operational UAT are blocked.

## Owner approval for provisioning

Keep the existing backend. Leave automatic rollouts disabled, traffic empty and environment overrides empty. After approving the identity and evidence plan, set the existing backend's environment name to `staging` and bind the dedicated service account. The App Hosting Backend API uses this account for both Cloud Build and Cloud Run. Confirm the update method can preserve zero builds and rollouts before making the change, then reread the exact backend and its traffic. Keep deployment operators separate from this account. [App Hosting backend fields](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends) · [Backend configuration](https://firebase.google.com/docs/app-hosting/configure)

The approved data grant should be exact.

| Item | Proposed setting |
| --- | --- |
| Dedicated account | `serviceAccount:fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com` with zero keys and zero Workspace delegation |
| Custom role | `projects/fika-os-dev/roles/StudioPreviewReader` containing only `datastore.entities.get` and `datastore.entities.list` |
| Project condition | `resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"` |
| Client rules | `apps/hospitality-menu-studio/firebase.staging.json` targets only the named database and loads `firestore.rules` with client reads and writes denied |

The current preview uses document gets, batch gets and bounded queries. The hosted entry point rejects Studio POSTs and catalogue package calls. A later transaction or write path must be reviewed against the IAM role. Firestore server SDKs use IAM even with client rules closed. [Firestore API permissions](https://firebase.google.com/docs/firestore/security/iam) · [Database-scoped IAM](https://firebase.google.com/docs/firestore/manage-databases)

The owner can approve these specific staging operations as separate actions. The rules deployment in this block targets the named Firestore rules entry only.

```powershell
gcloud iam service-accounts create fika-menu-studio-staging --project=fika-os-dev --display-name="Hospitality Menu Studio staging"
gcloud firestore databases create --project=fika-os-dev --database=hospitality-menu-studio --location=europe-west4 --type=firestore-native --edition=standard --delete-protection
firebase deploy --project fika-os-dev --config apps/hospitality-menu-studio/firebase.staging.json --only firestore:rules
gcloud iam roles create StudioPreviewReader --project=fika-os-dev --title="Studio staging preview reader" --permissions=datastore.entities.get,datastore.entities.list --stage=GA
gcloud projects add-iam-policy-binding fika-os-dev --member=serviceAccount:fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com --role=projects/fika-os-dev/roles/StudioPreviewReader --condition='title=StudioNamedDatabaseOnly,expression=resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"'
```

### Managed build isolation

The current default compute identity has unconditional staging-project grants for `roles/firebase.sdkAdminServiceAgent`, `roles/firebaseapphosting.computeRunner` and `roles/storage.objectViewer`. These include Firestore writes and broad Storage access. The dedicated account should receive a separately reviewed scoped build permission set. Do not copy the default grants.

The managed regional `firebaseapphosting-images` repository already contains other staging applications. Artifact Registry IAM is repository-scoped. A repository-wide pull/push grant for Studio would therefore cover unrelated images. Obtain a supported Studio-only build/artifact boundary on the existing backend or an explicitly reviewed change to the isolation requirement. The current plan treats the shared repository as a blocker for granting build permissions. Keep both build and runtime closed until that boundary and the relevant Google-managed service-agent paths are verified. [Artifact Registry IAM](https://docs.cloud.google.com/artifact-registry/docs/access-control) · [App Hosting Compute Runner permissions](https://firebase.google.com/docs/projects/iam/roles-predefined-product)

For the platform permissions, review the exact App Hosting backend and build binding, the linked Developer Connect repository's read-only source permissions, the artifact upload/download path and platform telemetry. The approved principal may need `firebaseapphosting.builds.update`, `artifactregistry.repositories.uploadArtifacts`, `artifactregistry.repositories.downloadArtifacts`, and `developerconnect.gitRepositoryLinks.fetchReadToken` on those exact resources when the platform supports equivalent scoped roles. Storage access needs separate exact cache or build-object evidence if required. Project-wide Storage, Firebase Admin, secret, IAM and Developer Connect token roles are outside this approval. An actual method or scope that cannot be established remains blocked. [Developer Connect roles](https://docs.cloud.google.com/developer-connect/docs/access-control) · [#181 staging isolation requirements](https://github.com/derekfika/fika-os/issues/181)

Record the following results for the exact effective build and runtime principal. Read direct and inherited policies and use Policy Troubleshooter with the exact resource context. Permission denial from an operator credential, an unavailable API, a missing service account or an unknown policy result cannot establish effective denial. Policy Troubleshooter returned `SERVICE_DISABLED` in the initial staging probe. Its enablement, or approval of an equivalent read-only policy verification path, is a separate owner action.

| Expected | Probe |
| --- | --- |
| Allow | `datastore.entities.get` and `datastore.entities.list` on the named Studio database |
| Deny | `datastore.entities.create`, `datastore.entities.update` and `datastore.entities.delete` on the Studio database |
| Deny | Get, list and write permission on `fika-os-dev/(default)`, any other staging database and all production databases |
| Deny | Application Storage object get/list/create, secrets access, unrelated artifact download/upload, unrelated repository tokens, IAM policy mutation, deployment permissions and service-account impersonation |
| Verify absent | Service account keys, Workspace delegation, Drive ACLs, Calendar and mail scopes, schedulers, notification or downstream append/write permissions |

Inspect storage and external service policies by exact resource. Avoid reading data or relying on differences in error messages to infer IAM. [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)

### AUTHMOD and custom domain

Register `hospitality-menu-studio` in the staging Hub only as enabled and hidden, organisation-only (`scopeModel: none`), with base URL `https://menu-studio-staging.fikacatering.com`. Set bundle `hospitality-menu-studio-preview`, standard resource `hospitality-menu-studio.preview` and standard actions `["View"]`. Give each approved pre-bound person the direct app assignment and a separate explicit, direct organisation View grant on that resource. Use the governed AUTHMOD operation to record actor, reason and exact grant, then confirm the current package is published. The Studio-specific sign-in route verifies the existing Firebase binding, access package, exact staging Hub origin and CSRF before issuing a session. Legacy Rotations and generic Full Access grant no Studio permission.

Use the existing App Hosting custom-domain entry. Read its `customDomainStatus.requiredDnsUpdates` before approving any edits at the authoritative DNS provider. Verify the exact A, TXT ownership and ACME CNAME records, then wait for App Hosting to report `OWNERSHIP_ACTIVE`, `HOST_ACTIVE` and `CERT_ACTIVE`. Record authoritative DNS plus App Hosting verification. Keep alternate hosting origins out of the Studio access path. [App Hosting custom domains](https://firebase.google.com/docs/app-hosting/custom-domain)

## First-release plan prerequisites

The merged provisioning baseline is `e7a4810913b117c994c9c5b945a1201d0f608a87`. It contains the preflight and closed release mapping. The first-release source still needs a merged staging-runtime and Hub admission candidate with exact-source CI, verified policy and DNS evidence, and a reviewed governed staging-only release mapping with empty-baseline and recovery support. This procedure prepares a read-only plan after those gates. It does not authorise a deployment.

1. Observe the existing backend, runtime identity, staging environment, branch, repo and root. Rerun preflight and confirm zero builds, rollouts, traffic and pending operations. Preserve the IAM, DNS and access evidence.
2. Pin the exact merge commit and source-bound CI for each affected app, including the staging Hub admission dependency. Record an empty first-release baseline without inventing a previous revision and use the governed dry run once that exact target is supported.
3. Present the dry run and environment evidence for approval. The eventual verification must check the exact served SHA, staging custom-domain build identity, unauthenticated API denial, allowed and denied persons, stale sessions and wrong-origin returns. Keep Firestore read-only during that acceptance. If the first attempt fails, retain the deployment journal and use the reviewed first-release recovery procedure. [Release workflow](workflow.md) · [Studio ADR](../architecture/hospitality-menu-studio.md)
