# Hospitality Menu Studio hosted staging

[#586](https://github.com/derekfika/fika-os/issues/586) · [Proposed #181 exception](hospitality-menu-studio-isolation.md) · [Governed releases](workflow.md)

## Proposed target and approvals

| Setting | Exact value |
| --- | --- |
| Firebase project | `fika-menu-studio-dev` pending availability and owner approval of project, folder and billing |
| Region, backend, environment | `europe-west4`, `fika-menu-studio-staging`, `staging` |
| Source | `derekfika/fika-os`, live branch `main`, app root `apps/hospitality-menu-studio` |
| Build and runtime identity | `fika-menu-studio-staging@fika-menu-studio-dev.iam.gserviceaccount.com` |
| Firestore | `projects/fika-menu-studio-dev/databases/hospitality-menu-studio`, Standard Native, delete protected |
| Browser and identity authority | `https://menu-studio-staging.fikacatering.com/` and `https://staging-os.fikacatering.com/` |

The older `fika-os-dev` Studio backend, service account and database belong to the superseded shared-project plan. Leave them and their data in place. The dedicated project uses the existing standard managed App Hosting build and runtime path, its own managed image repository, and no Studio production mapping.

## 1. Provision without an initial build

The following are operator commands for separately approved infrastructure actions. Check the approved folder and billing account before use. A failed project describe can mean either absence or lack of visibility. Confirm the ID at creation and stop if unavailable. Changing the ID requires changes to the reviewed source pins.

```powershell
$studioProject = 'fika-menu-studio-dev'
$studioRegion = 'europe-west4'
$studioBackend = 'fika-menu-studio-staging'
$studioRuntime = "$studioBackend@$studioProject.iam.gserviceaccount.com"
$studioDatabase = 'hospitality-menu-studio'
gcloud projects create $studioProject --folder=$studioApprovedFolder
gcloud billing projects link $studioProject --billing-account=$studioApprovedBillingAccount
firebase projects:addfirebase $studioProject
gcloud iam service-accounts create $studioBackend --project=$studioProject
gcloud firestore databases create --project=$studioProject --database=$studioDatabase --location=$studioRegion --type=firestore-native --edition=standard --delete-protection
```

Approve the exact grants below before attaching the workload account. Read the current Compute Runner role and verify its effective reach. The Firestore condition applies to both transaction and entity permissions, with no document delete or database administration.

```powershell
$studioRole = "projects/$studioProject/roles/StudioDraftAuthor"
$studioCondition = 'title=StudioNamedDatabaseOnly,expression=resource.name == "projects/fika-menu-studio-dev/databases/hospitality-menu-studio"'
gcloud iam roles create StudioDraftAuthor --project=$studioProject --title='Studio synthetic draft author' --permissions='datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update' --stage=GA
gcloud projects add-iam-policy-binding $studioProject --member="serviceAccount:$studioRuntime" --role=$studioRole --condition=$studioCondition
gcloud projects add-iam-policy-binding $studioProject --member="serviceAccount:$studioRuntime" --role='roles/firebaseapphosting.computeRunner' --condition=None
```

Publish only the deny-all client rules from `apps/hospitality-menu-studio/firebase.staging.json` to the named database under a separate rules approval (`firebase deploy --project $studioProject --config apps/hospitality-menu-studio/firebase.staging.json --only firestore:rules`). The Admin SDK uses IAM and selects the database explicitly. Leave the shared-project reader boundary outside these actions. [Firestore server IAM methods](https://docs.cloud.google.com/firestore/native/docs/security/iam) · [Per-database IAM conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions)

Enable App Hosting and establish the new project's GitHub connection for this repository using the Firebase App Hosting GitHub app. Create the backend without a source link and without deploying. The installed Firebase CLI's non-interactive backend-create path skips source linking and rollout. Review the exact command and any API or service-agent creation in the same provisioning approval.

```powershell
firebase apphosting:backends:create --project $studioProject --backend $studioBackend --primary-region $studioRegion --service-account $studioRuntime --root-dir apps/hospitality-menu-studio --non-interactive
```

Use the managed App Hosting API or backend settings to apply the following configuration in order. Observe each long-running operation to terminal success and reread the affected resource before the next request.

1. Set Traffic rollout policy to disabled before linking a source. For the REST Traffic resource, send only the `rolloutPolicy` update. Once the link is present, verify it remains disabled while setting `codebaseBranch: main`.
2. Set the Backend `environment` to `staging` and the `codebase` to the dedicated Developer Connect link ending in `/gitRepositoryLinks/derekfika-fika-os` with `rootDirectory: apps/hospitality-menu-studio`. Patch only those fields with the verified backend ETag. Keep environment overrides empty.
3. Verify the attached service account, branch, environment, project, source and root. Verify empty build and rollout histories, zero current and target traffic and no release in flight. Do not use the interactive Firebase CLI setup path, which configures automatic rollouts before prompting for an initial deployment. [App Hosting backend API](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends/patch) · [Rollout settings](https://firebase.google.com/docs/app-hosting/rollouts)

## 2. Verify effective isolation

Use read-only policy evidence for the actual managed build/runtime principal and relevant service agents. Include inherited policies, groups, conditional bindings, service-account impersonation and any deny or principal-access policies. Verify the managed Git link and artifact/cache paths belong to the dedicated project. A missing project, permission error for the operator or an unknown troubleshooting result is a blocker.

- Allow the five named database permissions above only on `hospitality-menu-studio`. Deny deletion there. Deny all data access to the dedicated project's default database, the old `fika-os-dev` Studio and default databases, and production Firestore.
- Deny access to production and unrelated staging buckets, secrets, images, repository links and infrastructure. Check credentials in the serving revision. Keep keys, Workspace delegation, live catalogue, booking/customer access, signing, activation, operational triggers, webhooks and notifications absent.
- Use `gcloud projects get-iam-policy`, `gcloud iam service-accounts get-iam-policy`, and IAM Policy Troubleshooter with the exact IAM resource and actual principal. Record the effective allow/deny matrix and the identities. The sole cross-project application call is authenticated HTTPS to the staging Hub access endpoint. [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access)

## 3. Prepare staging Hub admission and DNS

The staging Hub needs its own approved exact-source release with Studio's access route. Use the existing Hub target and release procedure. Production Hub and generic app access stay closed to Studio. The staging route requires a currently bound person and the standing staging cookie, CSRF and custom-origin gates.

An authorised Hub operator can first preview the existing registration tool in Studio mode. From `apps/integration-hub` with verified user ADC, the exact staging project and its governed snapshot bucket configured, run:

```powershell
$env:FIKA_RUNTIME_MODE = 'staging'
$env:FIREBASE_PROJECT_ID = 'fika-os-dev'
$env:FIKA_SNAPSHOT_BUCKET = 'fika-os-dev-staging-read-packages-europe-west4'
npx --no-install tsx scripts/provision-beverage-staging-registry.ts --studio
```

After approval use the same command with `--execute` to register the hidden application and publish its current references. Registration does not assign anyone. Using the existing audited account actions, give Sam's approved pre-bound person the standard app assignment, direct organisation-scoped `View`, and a separate direct `Manage` grant on `hospitality-menu-studio.preview`. Keep the registry's standard action list at `["View"]`. Confirm the current access package and use a time-limited grant if required by the approved UAT window. Test that a viewer cannot save, an expired or unassigned person cannot enter, and Rotations or Full Access grants do not admit a person.

Record the existing Studio host's authoritative DNS and the old App Hosting claim status. Ask the owner to approve releasing the old unserved domain association if necessary. Add the hostname to the new backend and capture its **fresh** Firebase-generated DNS additions and removals. Ask the DNS owner to approve the exact record changes. Verify authoritative DNS and the new backend's own domain status reaches `OWNERSHIP_ACTIVE`, `HOST_ACTIVE` and `CERT_ACTIVE`. Preserve evidence with claim values handled in the provisioning record. [Firebase custom-domain procedure](https://firebase.google.com/docs/app-hosting/custom-domain)

## 4. Prepare and approve the first release

From a clean governed checkout with the reviewed configuration merged, run:

```powershell
npm run fika -- studio-preflight --staging
npm run fika -- deploy menu-studio --staging --sha $approvedStudioMergeSha
```

Preflight reports read-only metadata and keeps manual approval gates visible. The deploy dry run verifies the exact protected merge and its CI, staged overlay, backend, active domain, project number, and two agreeing empty-baseline snapshots. It returns a `studioFirstReleaseApprovalHash`. Give the owner this hash, SHA, pinned target, effective IAM, DNS and staged Hub evidence. After approval, the authorised operator can run:

```powershell
npm run fika -- deploy menu-studio --staging --sha $approvedStudioMergeSha --execute --approve-hash $ownerApprovedStudioHash --reason $ownerApprovalReference
```

Verify the custom domain's served SHA and unauthenticated API denial. Sam's authenticated browser session must use the staging custom domain and exercise create/edit a fictional menu and dish, reload, week copy, conflict and recovery, history, draft restore and date preview. Use only fictional records prefixed with `DEMO`. Never import production material. Verify signing, publish, activation and operational integrations stay unavailable. A failed or ambiguous first attempt stays in its original journal with no previous viable rollout. Use the governed recovery path and separate approval for closing or reverting the domain and grants. [Governed recovery](workflow.md#rollback-and-interrupted-releases)
