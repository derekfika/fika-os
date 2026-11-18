# Menu Studio staging IAM and shared build scope

18 November 2026 · [#181 staging boundary](https://github.com/derekfika/fika-os/issues/181) · [Rollout runbook](hospitality-menu-studio-staging.md)

Use #181's existing `fika-os-dev` boundary. Studio uses one dedicated ambient App Hosting principal for managed Cloud Build and Cloud Run. Data access is limited to the named Studio Firestore database. Integration with Hub, Hospitality, CPU and allergen paths uses authorised staging HTTP and canonical interfaces. These services keep their data under their own identities.

## Evidence and decision

The dedicated account had no direct bindings in either project IAM policy observed on 18 November. This does not establish effective denial through resource policy, inheritance or impersonation. Policy Troubleshooter returned `SERVICE_DISABLED` for `fika-os-dev`. Owner approval is needed to enable it in staging or use an equivalent read-only policy evaluation path.

Hub and Hospitality use separate staging accounts with `roles/firebaseapphosting.computeRunner` and `roles/developerconnect.readTokenAccessor`. Hub also has Firestore and Firebase Auth roles for its own authority. CPU and Menu Planning use the common compute account with additional Firebase SDK and Storage roles. The observed Compute Runner role has 101 permissions, includes all three permissions in the token-accessor role, and includes no Firestore permissions. It can update build records and read/write Storage objects. Project-wide Storage would reach backups and stage catalogue/read-package buckets.

Use Google's documented equivalent-permissions path. Retain the non-data managed build permissions and scope the registry and any required Storage grant to their native resources. The following equivalence is prepared from the documented role and these actual resources. Verify its capability before release. Do not widen it automatically if the first managed build reports a gap. [App Hosting account and roles](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends) · [Compute Runner role](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseapphosting)

| Binding | Exact scope and role contents |
| --- | --- |
| `StudioManagedHosting` | Project `fika-os-dev`. Permissions from `roles/firebaseapphosting.computeRunner` except `artifactregistry.*` and `storage.*`. The retained Developer Connect permissions cover the project link, which is shared by these staging apps and points to `derekfika/fika-os`. Review effective build metadata and update reach at project scope. No additive token-accessor role. |
| `StudioManagedImages` | Repository `projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images` only. The Compute Runner permissions whose names start with `artifactregistry.` and are testable and custom-role supported at that repository. Production access, other repositories and project-level create-on-push stay outside the binding. |
| `StudioManagedSources` | If required for the approved managed build, grant only on `gs://firebaseapphosting-sources-594727519934-europe-west4`. The Compute Runner `storage.` permissions testable and custom-role supported at that bucket. Verify the managed source path and review the source bucket's shared reach before binding. |
| `StudioDraftAuthor` | Project `fika-os-dev`, role bound only when `resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"`. Permissions `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create` and `datastore.entities.update`. Transactions require the database permission. Exclude deletes and database administration. |

The managed repository contains CPU, Hospitality, Hub, Menu Planning and other staging images. A package named `fika-os` has one version dated 27 August 2026 and no matching current staging backend. Confirm its provenance before any Studio grant. A repository grant enables pull and push within the shared repository and cannot isolate one App Hosting image or tag. Require owner acceptance of the full effective artifact/build exposure. Keep the release blocked if production material is accessible or effective policy reaches unrelated data stores. [Repository IAM scopes](https://docs.cloud.google.com/artifact-registry/docs/access-control)

## Prepare exact role manifests and verify access

The following inventory prints role candidates for review. It creates no roles or bindings. Save the approved output and its digest with the owner decision.

```powershell
$studioProject = 'fika-os-dev'
$studioRegion = 'europe-west4'
$studioImages = 'firebaseapphosting-images'
$studioSourceBucket = 'firebaseapphosting-sources-594727519934-europe-west4'
$studioImagesResource = "//artifactregistry.googleapis.com/projects/$studioProject/locations/$studioRegion/repositories/$studioImages"
$studioSourcesResource = "//storage.googleapis.com/projects/_/buckets/$studioSourceBucket"
$studioBaseline = (gcloud iam roles describe roles/firebaseapphosting.computeRunner --format=json | ConvertFrom-Json).includedPermissions
$studioImageTestable = gcloud iam list-testable-permissions $studioImagesResource --format=json | ConvertFrom-Json
$studioSourceTestable = gcloud iam list-testable-permissions $studioSourcesResource --format=json | ConvertFrom-Json
$studioHostingPerms = @($studioBaseline | Where-Object { $_ -notmatch '^(artifactregistry|storage)\.' })
$studioImagePerms = @($studioImageTestable | Where-Object { $_.name -like 'artifactregistry.*' -and $_.name -in $studioBaseline -and $_.customRolesSupportLevel -ne 'NOT_SUPPORTED' } | ForEach-Object name)
$studioSourcePerms = @($studioSourceTestable | Where-Object { $_.name -like 'storage.*' -and $_.name -in $studioBaseline -and $_.customRolesSupportLevel -ne 'NOT_SUPPORTED' } | ForEach-Object name)
$studioDraftPerms = 'datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update'
[ordered]@{Hosting=$studioHostingPerms; Images=$studioImagePerms; Sources=$studioSourcePerms; Draft=$studioDraftPerms} | ConvertTo-Json
```

After owner approval, use the exact reviewed permission lists. The optional source role and binding require separate evidence that the managed build needs them.

```powershell
$studioMember = 'serviceAccount:fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com'
$studioDbCondition = 'title=StudioNamedDatabaseOnly,expression=resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"'
gcloud iam roles create StudioManagedHosting --project=$studioProject --title='Studio managed hosting' --permissions=($studioHostingPerms -join ',') --stage=GA
gcloud iam roles create StudioManagedImages --project=$studioProject --title='Studio managed images' --permissions=($studioImagePerms -join ',') --stage=GA
gcloud iam roles create StudioDraftAuthor --project=$studioProject --title='Studio draft author' --permissions=$studioDraftPerms --stage=GA
gcloud projects add-iam-policy-binding $studioProject --member=$studioMember --role="projects/$studioProject/roles/StudioManagedHosting" --condition=None
gcloud artifacts repositories add-iam-policy-binding $studioImages --project=$studioProject --location=$studioRegion --member=$studioMember --role="projects/$studioProject/roles/StudioManagedImages"
gcloud projects add-iam-policy-binding $studioProject --member=$studioMember --role="projects/$studioProject/roles/StudioDraftAuthor" --condition=$studioDbCondition
```

If that separately approved source grant is required:

```powershell
gcloud iam roles create StudioManagedSources --project=$studioProject --title='Studio managed sources' --permissions=($studioSourcePerms -join ',') --stage=GA
gcloud storage buckets add-iam-policy-binding "gs://$studioSourceBucket" --member=$studioMember --role="projects/$studioProject/roles/StudioManagedSources"
```

The client rules deny all direct access. If they need updating, obtain a separate rules approval and limit it to `firebase deploy --project fika-os-dev --config apps/hospitality-menu-studio/firebase.staging.json --only firestore:rules`. The server explicitly connects to the named database. [Firestore methods and permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam) · [Per-database conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions)

Check the exact principal and relevant service agents after proposed grants, including inherited bindings, resource policies and impersonation. Verify each authorised draft permission on Studio and deny document deletion. Verify Firestore access is denied for `fika-os-dev/(default)` and all production databases, plus production or unrelated buckets, secrets, images, IAM mutation and impersonation. Use exact resource paths for each check. An absent direct binding or a refused operator query is insufficient. This example is read only and needs an authorised troubleshooting consumer project:

```powershell
gcloud beta policy-troubleshoot iam '//firestore.googleapis.com/projects/fika-os/databases/(default)' --principal-email='fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com' --permission=datastore.entities.get --project=fika-os-dev
```

Confirm no keys, Workspace delegation, production connectors, schedulers, notification credentials or real operational data paths. If the approval or evidence fails, revoke the exact approved new bindings under rollback authority and preserve the resources and logs. [Effective IAM verification](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)
