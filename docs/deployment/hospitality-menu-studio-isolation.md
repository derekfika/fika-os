# Menu Studio staging isolation

18 November 2026 · [#586](https://github.com/derekfika/fika-os/issues/586) · [#181 staging contract](https://github.com/derekfika/fika-os/issues/181) · [Provisioning runbook](hospitality-menu-studio-staging.md)

## Decision

**Use a dedicated Cloud Build identity, a Studio-only Artifact Registry repository, and a separate Cloud Run runtime identity in `fika-os-dev`** if #181 remains in force. This keeps the required staging project and separates build permissions from the Studio runtime. Cloud Build produces an immutable image. The governed release operator will independently check the approved merge SHA and image digest before approving a traffic change. This path needs a reviewed release integration before it can deploy. [Cloud Build service accounts](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts) · [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity)

**For managed Firebase App Hosting, use a Studio-only Firebase project.** This confines App Hosting's combined build/runtime account and managed artifacts to Studio. It requires an explicit #181 exception because the current contract names `fika-os-dev`. Keep the stage Hub as the only authentication authority. Studio's new project would host Studio data only. The source must pin this selected project, and effective policies must deny direct access to both the shared staging and production projects. The current App Hosting backend stays unbuilt unless the owner approves a different plan for it. [Firebase environment isolation](https://firebase.google.com/docs/app-hosting/multiple-environments) · [App Hosting backend identity](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends)

| Path | Isolation and release implications |
| --- | --- |
| Existing App Hosting backend, Git source | **Blocked.** The regional `firebaseapphosting-images` repository contains other staging apps. Pull and push permissions are scoped to repositories. A separate account with repository access still reaches those images. |
| Existing App Hosting backend, prebuilt Studio image | App Hosting accepts an Artifact Registry container as a build source. A documented validate-only request on this backend accepted a Studio-only repository URI and a synthetic digest. Build and rollout histories remained empty. This proves request validation. Execution still needs proof of the selected image, both resulting identities, any copy or cache destination, and denial of the shared repository. The current release CLI verifies Git codebase provenance. Container-source support would need new digest-to-merge-SHA verification and recovery rules. |
| Dedicated project, managed App Hosting | Managed images and build caches have a Studio-only project boundary. App Hosting still uses one account for both phases, so the named data grant would also be available to build code. Requires #181 approval, new exact project and source pins, and proof of managed service-agent permissions before a rollout. |
| `fika-os-dev`, Cloud Build and Cloud Run | Separate build and runtime accounts and a separate image repository. Build gets source and artifact access. Runtime gets only the named database reads. Requires governed delivery work and an approved ingress/domain plan. The existing Google-managed Cloud Run service agent remains a shared platform principal. Neither Studio workload can impersonate it. |

Artifact Registry's IAM boundary and App Hosting's request validation contract are documented by Google. [Artifact Registry IAM](https://docs.cloud.google.com/artifact-registry/docs/access-control) · [App Hosting BuildSource](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends.builds#BuildSource) · [Validate-only API](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends.builds/create)

## Exact permission proposal

| Principal | Proposed permissions and boundary |
| --- | --- |
| Studio runtime | `datastore.entities.get` and `datastore.entities.list` in the custom role `StudioPreviewReader`, with `resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"` on the project binding. Startup uses the named SDK client. The hosted preview needs gets, batch gets and queries. |
| Studio external builder | `artifactregistry.repositories.get`, `artifactregistry.repositories.downloadArtifacts` and `artifactregistry.repositories.uploadArtifacts` on the Studio image repository. `logging.logEntries.create` for Cloud Logging. `storage.objects.get` on the exact immutable source archive only if the builder is the actor that fetches it. Set Cloud Build logs to `CLOUD_LOGGING_ONLY`. |
| Cloud Run platform service agent | Verify the existing platform pull path for the Studio image and the exact revision's runtime account. Grant image read on the Studio repository only where the observed pull principal needs it. Keep the runtime account out of this grant. |
| Governed operator | Approved build/revision/traffic operations and `iam.serviceAccounts.actAs` only on the selected account for each operation. Keep operator permissions out of the builder and runtime accounts, and restrict who can impersonate both. |

For managed App Hosting the Google-documented baseline is `roles/firebaseapphosting.computeRunner` or equivalent. The role inventory includes `firebaseapphosting.builds.update`, `developerconnect.gitRepositoryLinks.fetchReadToken`, artifact pull/push, Storage object actions and telemetry. Google publishes the supported role, but the exact smaller permission set for this backend's Git/image/cache path is unverified. Never attach this project-wide role in shared `fika-os-dev` for Studio. In a Studio-only project, restrict the build identity to that project, audit the resulting Storage and token reach, and use the actual build metadata to verify any equivalent narrower grants. [App Hosting IAM](https://firebase.google.com/docs/projects/iam/roles-predefined-product) · [Firestore method permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam) · [Cloud Build and repositories](https://docs.cloud.google.com/artifact-registry/docs/configure-cloud-build)

The exact database equality cannot grant permissions to `fika-os-dev/(default)`, another staging database or any `fika-os` database. Google IAM lint accepted the condition without findings. An allow binding does not cancel a grant from a different policy. Effective denial must still be established for the actual identities, including inherited policy, groups, impersonation and Principal Access Boundary policy. The current dedicated account and database are absent, and the current staged Policy Troubleshooter API returned `SERVICE_DISABLED`. [Firestore database IAM conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions) · [Effective policy checks](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)

## Owner-controlled provisioning

The following commands are prepared for the recommended Cloud Run route. Apply each group only after the owner approves its scope and the named resources have been inventoried. Preserve the existing App Hosting backend without traffic. Do not reuse its default compute account.

### 1. Create the staging resources

```powershell
$studioStageProject = 'fika-os-dev'
$studioStageRegion = 'europe-west4'
$studioDatabase = 'hospitality-menu-studio'
$studioImageRepo = 'fika-menu-studio-staging-images'
$studioStageRuntime = "fika-menu-studio-staging@$studioStageProject.iam.gserviceaccount.com"
$studioStageBuilder = "fika-menu-studio-build@$studioStageProject.iam.gserviceaccount.com"

gcloud iam service-accounts create fika-menu-studio-staging --project=$studioStageProject
gcloud iam service-accounts create fika-menu-studio-build --project=$studioStageProject
gcloud firestore databases create --project=$studioStageProject --database=$studioDatabase --location=$studioStageRegion --type=firestore-native --edition=standard --delete-protection
gcloud artifacts repositories create $studioImageRepo --project=$studioStageProject --location=$studioStageRegion --repository-format=docker --immutable-tags
```

Apply the isolated Firestore rules from the reviewed source when the rules change is approved. Confirm the database exists first. The config targets only the named database.

```powershell
firebase deploy --project fika-os-dev --config apps/hospitality-menu-studio/firebase.staging.json --only firestore:rules
```

For the managed alternative, ask the owner first to approve a #181 exception, the folder, billing account and a globally available project ID. Then create the project and add Firebase under separate approval. For example, with the approved ID in `$studioDedicatedProject` and the approved organisation values in the other variables:

```powershell
gcloud projects create $studioDedicatedProject --folder=$studioApprovedFolder
gcloud billing projects link $studioDedicatedProject --billing-account=$studioApprovedBillingAccount
firebase projects:addfirebase $studioDedicatedProject
```

Before creating a backend in that project, approve its exact repository connection, region, app root and dedicated account. Use App Hosting setup with automatic rollouts disabled and the initial deployment skipped. Its scope, service accounts, database name, source pin, DNS and deployment mapping require their own source review. Once that project is proven Studio-only, the managed service's documented compute role is scoped to that project. The data binding uses the new project's exact named database resource and the same two read permissions. No role is changed in the shared staging project for this alternative.

### 2. Approve the exact grants

```powershell
$studioDataCondition = 'title=StudioNamedDatabaseOnly,expression=resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"'
gcloud iam roles create StudioPreviewReader --project=$studioStageProject --title='Studio preview reader' --permissions='datastore.entities.get,datastore.entities.list' --stage=GA
gcloud projects add-iam-policy-binding $studioStageProject --member="serviceAccount:$studioStageRuntime" --role="projects/$studioStageProject/roles/StudioPreviewReader" --condition=$studioDataCondition

gcloud iam roles create StudioImagePublisher --project=$studioStageProject --title='Studio image publisher' --permissions='artifactregistry.repositories.get,artifactregistry.repositories.downloadArtifacts,artifactregistry.repositories.uploadArtifacts' --stage=GA
gcloud artifacts repositories add-iam-policy-binding $studioImageRepo --project=$studioStageProject --location=$studioStageRegion --member="serviceAccount:$studioStageBuilder" --role="projects/$studioStageProject/roles/StudioImagePublisher"

gcloud iam roles create StudioBuildLogWriter --project=$studioStageProject --title='Studio build log writer' --permissions='logging.logEntries.create' --stage=GA
gcloud projects add-iam-policy-binding $studioStageProject --member="serviceAccount:$studioStageBuilder" --role="projects/$studioStageProject/roles/StudioBuildLogWriter"
```

Use a dedicated source bucket if the governed build submits an archive. Approve the bucket name and exact SHA/object generation. Add only the required read privilege for the proven fetch principal. Until Cloud Build metadata can establish whether that is the builder or a Google-managed service agent, leave the grant pending. For a builder fetch, the proposed custom permission is `storage.objects.get` with a binding on the dedicated bucket and the condition `resource.name == "projects/_/buckets/APPROVED_BUCKET/objects/approved/EXACT_MERGE_SHA.tgz"`. A future owner-approved build config must pin the storage object generation. Keep repository tokens, deployment permissions and Firestore permissions outside the builder role.

### 3. Verify effective policy before authorising traffic

Use an approved read-only operator with visibility over the relevant project, folder, organisation and group policies. Enable Policy Troubleshooter under separate approval or choose an equivalent approved policy evaluation path. The project IAM inventory and linter are useful evidence. They are insufficient to prove effective denial. The following queries are read-only.

```powershell
gcloud projects get-iam-policy fika-os-dev --format=json
gcloud artifacts repositories get-iam-policy fika-menu-studio-staging-images --project=fika-os-dev --location=europe-west4 --format=json
gcloud iam service-accounts get-iam-policy $studioStageRuntime --project=fika-os-dev --format=json
gcloud iam service-accounts get-iam-policy $studioStageBuilder --project=fika-os-dev --format=json
gcloud iam service-accounts keys list --iam-account=$studioStageRuntime --managed-by=user --project=fika-os-dev
gcloud iam service-accounts keys list --iam-account=$studioStageBuilder --managed-by=user --project=fika-os-dev

$studioNamedDb = '//firestore.googleapis.com/projects/fika-os-dev/databases/hospitality-menu-studio'
$studioSharedDb = '//firestore.googleapis.com/projects/fika-os-dev/databases/(default)'
$studioProdDb = '//firestore.googleapis.com/projects/fika-os/databases/(default)'
$studioSharedRepo = '//artifactregistry.googleapis.com/projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images'
gcloud beta policy-troubleshoot iam $studioNamedDb --principal-email=$studioStageRuntime --permission=datastore.entities.get --project=fika-os-dev --format=json
gcloud beta policy-troubleshoot iam $studioNamedDb --principal-email=$studioStageRuntime --permission=datastore.entities.create --project=fika-os-dev --format=json
gcloud beta policy-troubleshoot iam $studioSharedDb --principal-email=$studioStageRuntime --permission=datastore.entities.get --project=fika-os-dev --format=json
gcloud beta policy-troubleshoot iam $studioProdDb --principal-email=$studioStageRuntime --permission=datastore.entities.get --project=fika-os-dev --format=json
gcloud beta policy-troubleshoot iam $studioSharedRepo --principal-email=$studioStageBuilder --permission=artifactregistry.repositories.downloadArtifacts --project=fika-os-dev --format=json
```

Extend this matrix to named-read permissions for the runtime, write denials on Studio, all database access for the builder, all production database and bucket resources, unrelated staging buckets/images/secrets, IAM mutation, service-account impersonation and deployment authority. Explicitly verify only the intended service agents and operator can attach each account, and that neither workload can impersonate the other. Use exact condition context for each resource. An unknown result leaves the release gate open. Verify Google Workspace delegation, external notification integrations and operational triggers separately.

### 4. Pin and approve the first release

Approve the selected architecture and a reviewed release implementation. Bind the exact protected merge SHA and its CI to the image digest, build actor, runtime actor, database and serving target. The first plan must identify an empty baseline and retain a recovery journal. For Cloud Run, prepare a Studio-only serverless NEG behind an external HTTPS Application Load Balancer, restrict ingress to internal and load-balanced traffic, and verify the exact custom host. Review the staging Hub delivery, AUTHMOD grants and DNS separately, including any release of the existing App Hosting domain claim. The approval comes before any first rollout. [Cloud Run ingress](https://docs.cloud.google.com/run/docs/securing/ingress) · [Custom domains](https://docs.cloud.google.com/run/docs/mapping-custom-domains)

The staging admission source in [#607](https://github.com/derekfika/fika-os/pull/607) can integrate as source before provisioning. The default hosting overlay is closed, production is rejected, the staging runtime requires exact project and origin and stays read-only, and the release mapping is absent. Those checks do not establish IAM isolation. The selected architecture may require a later runtime or release configuration change. At review, `main` was `e7a4810913b117c994c9c5b945a1201d0f608a87` and #607 was `cd5b39b1885a8d5ddb7577d72671da7c8b93c6d0`. [Exact #607 validation](https://github.com/derekfika/fika-os/actions/runs/44339338958)

### 5. Reverse only the approved additions

Before first traffic, keep the DNS change uncommitted where possible and hold the target closed. If IAM verification fails, remove the exact new bindings after approval rather than replacing whole policies. Preserve the database, rules, image and audit evidence. Example reversal for the proposed Cloud Run grants:

```powershell
gcloud projects remove-iam-policy-binding $studioStageProject --member="serviceAccount:$studioStageRuntime" --role="projects/$studioStageProject/roles/StudioPreviewReader" --condition=$studioDataCondition
gcloud artifacts repositories remove-iam-policy-binding $studioImageRepo --project=$studioStageProject --location=$studioStageRegion --member="serviceAccount:$studioStageBuilder" --role="projects/$studioStageProject/roles/StudioImagePublisher"
gcloud projects remove-iam-policy-binding $studioStageProject --member="serviceAccount:$studioStageBuilder" --role="projects/$studioStageProject/roles/StudioBuildLogWriter"
```

Remove any separately approved input-object binding using its original role, member and condition. Update only newly touched DNS records if DNS rollback is approved. A first rollout has no previously verified revision. If it fails, retain the journal and stop external Studio traffic through the approved first-release recovery action. An unknown attempt stays pending until the serving state and audit evidence resolve it. Roll back a later healthy release only to independently verified prior Studio lineage. [Governed recovery](workflow.md#rollback-and-interrupted-releases)
