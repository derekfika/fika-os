# Menu Studio staging IAM and shared App Hosting scope

19 November 2026 · [#586 Menu Studio](https://github.com/derekfika/fika-os/issues/586) · [#181 staging boundary](https://github.com/derekfika/fika-os/issues/181) · [Studio release runbook](hospitality-menu-studio-staging.md)

Use the existing `fika-os-dev` App Hosting backend, dedicated Studio identity and named Firestore database. The Hub and Hospitality staging identities use the same predefined Compute Runner role at project scope. App Hosting uses its configured identity for both Cloud Build and Cloud Run. The Studio app separately uses the staging Hub for admission and authorized catalogue reads. [Google App Hosting identity](https://firebase.google.com/docs/app-hosting/about-app-hosting)

## Exact grants for owner review

| Role | Binding resource | Scope |
| --- | --- | --- |
| `roles/firebaseapphosting.computeRunner` | Project `fika-os-dev` | Standard managed App Hosting role for `fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com`. |
| `projects/fika-os-dev/roles/StudioDraftAuthor` | Project `fika-os-dev` with condition `resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"` | `datastore.databases.get` for transaction begin and rollback, and `datastore.entities.get`, `list`, `create` and `update`. |

The Compute Runner grant observed on 19 November has 101 permissions. The scope covers:

- **Staging images.** Both the shared `firebaseapphosting-images` repository and `cloud-run-source-deploy` are in the project. The role includes artifact pull, upload, export, mutable tag updates, and attachment creation and deletion. Another staging package or tag can be affected.
- **Staging Storage.** Object read/list/create/update/delete reach the Firestore export, private Kafoodle catalogue, Hub read-package, App Hosting source and Cloud Run source buckets unless an effective policy restricts the operation. The staging export paths were traced to `fika-os-dev` Firestore export records. They and the private catalogue and access packages are a genuine staging data confidentiality and integrity risk.
- **Staging build and source metadata.** App Hosting build metadata updates and read-token access for the shared Developer Connect link are project scoped. The linked Git repository is `derekfika/fika-os`.

The predefined role contains no Firestore, Secret Manager access, or IAM impersonation permissions. The separate project `fika-os` receives no grant in this plan. Confirm effective production denial independently. Role definitions, source-project metadata, and direct binding reads are limited evidence. [Compute Runner permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseapphosting) · [Firestore IAM conditions](https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure-per-database-access-permissions)

## Approved provisioning and verification

Before applying the bindings, record the owner decision accepting the actual shared staging scope. Verify the live role and target. Create `StudioDraftAuthor` only when absent. If it already exists, review its exact permission set and stop on a difference.

```powershell
$studioProject = 'fika-os-dev'
$studioMember = 'serviceAccount:fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com'
$studioDraftRole = 'projects/fika-os-dev/roles/StudioDraftAuthor'
$studioDraftPermissions = 'datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update'
$studioDbCondition = 'title=StudioNamedDatabaseOnly,expression=resource.name == "projects/fika-os-dev/databases/hospitality-menu-studio"'
gcloud iam roles create StudioDraftAuthor "--project=$studioProject" --title='Studio draft author' "--permissions=$studioDraftPermissions" --stage=GA
gcloud projects add-iam-policy-binding $studioProject "--member=$studioMember" '--role=roles/firebaseapphosting.computeRunner' --condition=None
gcloud projects add-iam-policy-binding $studioProject "--member=$studioMember" "--role=$studioDraftRole" "--condition=$studioDbCondition"
```

Read back the project policy and role. Have an authorized operator verify the effective policy, including inheritance and resource policies. Test using an already authorized short-lived credential for the exact Studio principal. A new temporary verifier grant needs separate approval and must expire and be removed. Record the identity, permission, exact resource, result, timestamp and approval reference. Preserve the existing rules and authentication evidence.

- Verify bounded Firestore get/list and a read-only begin/rollback transaction against the named Studio database. Verify the exact conditioned policy allows draft creates and updates and denies deletes and administration.
- Require effective denial on default staging Firestore and every production Firestore database. Check production Artifact Registry and Storage, Secret Manager in both projects, other service-account impersonation and IAM mutation. Use policy and read-only probes without production writes or fetching protected payloads.
- Compare effective shared staging images, Storage and build-metadata reach to the approved exposure. Keep the release held if production or unrelated credentials are accessible, if access exceeds the approved staging scope, or if required evidence is unknown. Record any unresolved result without treating it as a denial.

On failure, stop before attaching the account. Revoke only the exact new, approved bindings under the rollback authorization. The [release runbook](hospitality-menu-studio-staging.md) covers the ETag-guarded backend update and separate rollout hash. [Effective IAM verification](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) · [Firestore method permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam)
