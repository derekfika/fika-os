# Menu Studio staging IAM and App Hosting

20 November 2026 · [#586 Menu Studio](https://github.com/derekfika/fika-os/issues/586) · [#181 staging boundary](https://github.com/derekfika/fika-os/issues/181) · [Studio release runbook](hospitality-menu-studio-staging.md)

Use the existing `fika-os-dev` backend and the dedicated Studio service account for managed Cloud Build and Cloud Run. The initial grants have no Cloud Storage permissions. This keeps Studio out of the shared staging Firestore exports, operational packages and source buckets if the effective IAM checks pass. The Studio app uses the staging Hub for admission and authorized catalogue reads. [App Hosting backend identity](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends)

## Approve the exact role manifest

The [IAM manifest](../../tools/workflow/studio-staging-iam.json) specifies every permission, binding resource, condition and principal. Its preflight digest is the SHA-256 of its compact JSON representation. The initial digest is `aa4c8bbc116d145a86768cc204c7513fe1272b29ed9d706a114aa56dee485f01`.

| Role | Binding and reach |
| --- | --- |
| `StudioManagedHosting` | Project `fika-os-dev`. The 32 managed-hosting permissions from the live Compute Runner role after removing `storage.*` and `artifactregistry.*`. Includes staging build metadata updates and Developer Connect Git read-token access. |
| `StudioManagedImages` | Only `projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images`. Includes `artifactregistry.repositories.downloadArtifacts` and `artifactregistry.repositories.uploadArtifacts`. Docker manifest uploads can move mutable tags across every package in this shared repository. The owner must explicitly accept repository-wide pull and push, including this tag risk. |
| `StudioDraftAuthor` | Project binding conditioned on `resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"`. Includes `datastore.databases.get` for transactions and `datastore.entities.get`, `list`, `create` and `update`. |

The predefined Compute Runner role and any Cloud Storage grant are outside the initial manifest. The GitSource managed build remains to be exercised with this exact principal. If the managed build fails for a source permission, record the exact permission, resource and credential from the build evidence. Review a minimum resource-scoped correction separately. [Docker permissions](https://docs.cloud.google.com/artifact-registry/docs/audit-logging) · [Firestore IAM conditions](https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure-per-database-access-permissions)

## Provision and verify after approval

Create only absent roles from the approved manifest. Reuse an existing role only after reading back the exact permission set. Record the owner decision and use only the manifest's project and repository grants.

```powershell
$studioProject = 'fika-os-dev'
$studioManifest = Get-Content -LiteralPath 'tools/workflow/studio-staging-iam.json' -Raw | ConvertFrom-Json
foreach ($studioBinding in $studioManifest.bindings) {
  $studioRoleId = ($studioBinding.role -split '/')[-1]
  $studioPermissions = $studioBinding.permissions -join ','
  # Run the following command only if this exact role is absent.
  # gcloud iam roles create $studioRoleId "--project=$studioProject" "--title=$studioRoleId" "--permissions=$studioPermissions" --stage=GA
}
$studioMember = $studioManifest.principal
$studioHosting = $studioManifest.bindings | Where-Object role -like '*/StudioManagedHosting'
$studioImages = $studioManifest.bindings | Where-Object role -like '*/StudioManagedImages'
$studioDraft = $studioManifest.bindings | Where-Object role -like '*/StudioDraftAuthor'
$studioCondition = "title=$($studioDraft.condition.title),expression=$($studioDraft.condition.expression)"
gcloud projects add-iam-policy-binding $studioProject "--member=$studioMember" "--role=$($studioHosting.role)" --condition=None
gcloud artifacts repositories add-iam-policy-binding firebaseapphosting-images "--project=$studioProject" --location=europe-west4 "--member=$studioMember" "--role=$($studioImages.role)"
gcloud projects add-iam-policy-binding $studioProject "--member=$studioMember" "--role=$($studioDraft.role)" "--condition=$studioCondition"
```

The preflight and first-release plan check the three direct role definitions and bindings through read-only IAM calls. Effective permissions include inherited, resource-level and conditional paths. Have an authorized operator verify these paths and probe as the exact Studio service account using a short-lived credential. Any temporary token-minting permission must be separately authorized, scoped to Studio's account, time-limited and removed after verification. Record each resource, permission, outcome, operator, timestamp and approval reference.

- Verify bounded Firestore get/list and read-only begin/rollback on the named Studio database. Confirm the exact conditioned role allows draft create and update and excludes delete and administration.
- Require effective denial on default Firestore, Cloud Storage, unrelated Artifact Registry repositories, production resources, Secret Manager, IAM mutations and other service-account credentials. Check the independent Workspace boundary.
- Verify exactly the approved Artifact Registry permissions on the shared staging repository. Use authorization probes without uploading images or moving tags. Keep unknown results unresolved. Data classification of a bucket that Studio is verified unable to access is outside this gate.

Keep an unresolved or failed gate held before attaching the account. On failure, remove only the newly applied bindings under the rollback authorization. Use the [release runbook](hospitality-menu-studio-staging.md) for the approved backend update and separate rollout hash. [Effective IAM verification](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) · [Firestore method permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam)
