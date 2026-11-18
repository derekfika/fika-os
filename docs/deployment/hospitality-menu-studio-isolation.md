# Menu Studio preview and staging decision

18 November 2026 · [#586](https://github.com/derekfika/fika-os/issues/586) · [#181](https://github.com/derekfika/fika-os/issues/181) · [Existing shared-project runbook](hospitality-menu-studio-staging.md)

## Decision

Give Sam a complete synthetic authoring preview locally first. If a hosted preview is needed, use a **Studio-only Firebase staging project with managed App Hosting**. The existing managed Git build uses a repository that already holds other FIKA staging images. Artifact Registry IAM stops at the repository boundary, and App Hosting selects one service account for build and runtime. A dedicated project confines those standard managed permissions to Studio. An external builder or prebuilt image path in the shared project would need additional provenance and release tooling. [Firebase environment isolation](https://firebase.google.com/docs/app-hosting/multiple-environments) · [App Hosting backend identity](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends) · [Artifact Registry IAM](https://docs.cloud.google.com/artifact-registry/docs/access-control)

The shared `fika-os-dev` backend has no builds, rollouts or traffic. The dedicated account and named database now exist there. Their existence and the empty history were checked separately from effective IAM. The existing preflight remains blocked by the backend configuration, unresolved custom-domain status and shared artifacts.

## 1. Give Sam the local preview

Use [Studio's loopback development instructions](../../apps/hospitality-menu-studio/README.md) with the `demo-fika-os` emulator and the explicit development fixture flag. Supply a repeatable synthetic seasonal menu and special collection with sample dishes, six-week rotations and a per-box assortment. Confirm Sam can create, edit, copy a week, reload a saved draft, recover a conflicted edit, compare versions and preview by event date. Verify the actual browser at desktop, tablet and narrow widths before marking the preview accepted. Label all records as demo data. Preserve existing publication, signing and activation gates.

The local HTTP smoke opened the fixture dashboard, saved a dish and rotating menu, rejected a stale save, compared draft versions and verified the date preview omitted kitchen copy. Browser acceptance and the reusable demo dataset are still pending.

## 2. Approve and prepare one isolated staging target

Amend #181 to allow exactly one owner-approved Firebase project ID for Studio's synthetic staging preview. Keep the existing shared staging Hub as the AUTHMOD authority over HTTPS. Keep its exact origin and Studio admission checks, with explicit View for Sam and denied or expired sessions closed. Use no cross-project workload IAM, production or shared operational data, secrets, Workspace credentials, background jobs, notifications, signing, publication, booking, collection activation or CPU handoffs.

Approve the project ID, folder and billing account, then provision only the reviewed staging target. Use backend `fika-menu-studio-staging`, environment `staging`, region `europe-west4`, repository `derekfika/fika-os`, branch `main` and app root `apps/hospitality-menu-studio`. Keep automatic rollouts off and skip the initial deployment. Reserve the Studio custom domain only with DNS and AUTHMOD approval. Restrict the new project to Studio's artifacts and synthetic data.

```powershell
gcloud projects create $studioStageProject --folder=$studioApprovedFolder
gcloud billing projects link $studioStageProject --billing-account=$studioApprovedBillingAccount
firebase projects:addfirebase $studioStageProject
gcloud iam service-accounts create fika-menu-studio-staging --project=$studioStageProject
gcloud firestore databases create --project=$studioStageProject --database=hospitality-menu-studio --location=europe-west4 --type=firestore-native --edition=standard --delete-protection
```

Preserve the named-database read-only boundary. The proposed `StudioPreviewReader` role has `datastore.entities.get` and `datastore.entities.list`, conditional on `resource.name == "projects/APPROVED_PROJECT/databases/hospitality-menu-studio"`. Use the exact approved project ID in the condition and the Admin SDK configuration. Keep client rules closed. Seed fictional records through a separately approved operator action in that database. Obtain separate approval for Google's standard managed App Hosting compute role (`roles/firebaseapphosting.computeRunner`) and service-account attachment **in the dedicated project only**. Review the effective permissions from both roles together and remove any additional data access. The existing shared-project account and its proposed binding require no changes for this path. [Firestore per-database IAM](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions) · [App Hosting IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseapphosting)

```powershell
$studioRuntime = "fika-menu-studio-staging@$studioStageProject.iam.gserviceaccount.com"
$studioReader = "projects/$studioStageProject/roles/StudioPreviewReader"
$studioCondition = 'title=StudioNamedDatabaseOnly,expression=resource.name == "projects/{0}/databases/hospitality-menu-studio"' -f $studioStageProject
gcloud iam roles create StudioPreviewReader --project=$studioStageProject --title='Studio preview reader' --permissions='datastore.entities.get,datastore.entities.list' --stage=GA
gcloud projects add-iam-policy-binding $studioStageProject --member="serviceAccount:$studioRuntime" --role=$studioReader --condition=$studioCondition
```

A separate builder and custom image pipeline are optional for this synthetic preview. Keep hosted View read-only. A later hosted editor requires its own reviewed, draft-only path in the synthetic database. Keep operational cutover under #586's separate safety and acceptance gates.

## 3. Gate the first hosted release

Review a source change pinning the new project, Studio custom origin, staging Hub, named database and exact staging backend. [#607](https://github.com/derekfika/fika-os/pull/607) can integrate as closed-by-default source. Its current staging pin targets the shared project. Keep the production release mapping empty.

Before asking for rollout approval, save the read-only preflight and effective policy evidence for the actual attached workload and relevant service agents. Verify named reads allowed and named writes denied. Verify default and other Firestore databases, shared artifacts, production and unrelated staging buckets and secrets denied. Include inherited bindings and impersonation. The existing IAM lint accepted the exact resource equality. Effective denial is still a separate gate. [IAM Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)

After the reviewed staging mapping exists, prepare `fika deploy menu-studio --staging --sha <protected-merge-SHA>` as a dry run with passing exact-source `Workflow / merge-gate` CI. Approve the exact target, IAM evidence, AUTHMOD and DNS setup, and first-release recovery action before using `--execute`. Verify the served SHA and authenticated permitted/denied journeys on the custom domain before handing it to Sam.

For rollback before the first verified release, close Studio traffic using the approved recovery action and revoke only the approved new IAM and AUTHMOD bindings. Remove the conditional reader binding with the same project, member, role and condition shown above, using `gcloud projects remove-iam-policy-binding`. Reverse only the affected DNS changes if approved. Retain the synthetic data, audit evidence and release journal. [Governed releases and recovery](workflow.md#rollback-and-interrupted-releases)
