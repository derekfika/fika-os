# Hospitality Menu Studio integrated staging

[#586](https://github.com/derekfika/fika-os/issues/586) · [Managed build and data IAM plan](hospitality-menu-studio-isolation.md) · [Governed releases](workflow.md)

| Setting | Existing target |
| --- | --- |
| Project, region and backend | `fika-os-dev`, `europe-west4`, `fika-menu-studio-staging` |
| Source and root | `derekfika/fika-os`, `main`, `apps/hospitality-menu-studio` |
| Environment and account to attach after approval | `staging`, `fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com` |
| Named Firestore | `projects/fika-os-dev/databases/hospitality-menu-studio` |
| Browser and admission authority | `https://menu-studio-staging.fikacatering.com/` and `https://staging-os.fikacatering.com/` |

Read-only checks on 18 November 2026 confirmed the dedicated account and delete-protected database exist. The backend points at the expected repository and root, has automatic rollouts disabled, and has zero builds, rollouts and current or target traffic. Its environment is unset and the default shared compute account is attached. App Hosting reports the existing domain's ownership, routing and certificate active. DNS work is complete for those observed states. Reread the same backend before first release, and capture fresh Firebase records only if its domain status requires a change.

## 1. Integrate and serve the Hub admission route

Integrate #609 through the protected merge gate. Use the exact merged source to plan the Hub staging release. Compare its Hub and shared-runtime delta to the verified serving SHA. Be sure the effective Hub environment remains staging and Hospitality email delivery remains disabled.

```powershell
npm run fika -- deploy hub --staging --sha $studioMergeSha
```

Execute this governed Hub rollout only under the owner's staging Hub direction, limited to the reviewed admission delta. Verify the serving SHA and that the unauthenticated Studio access route returns an admission error from the staging Hub. The previous serving SHA `2e3b1df8ccdd4d06c7315997d638a22fd9781e00` returned 404. Production and generic application admission stay closed to Studio.

The authorised staging Hub operator can preview registration using user Application Default Credentials. Set the exact staging project and governed snapshot bucket, then run from `apps/integration-hub`:

```powershell
$env:FIKA_RUNTIME_MODE = 'staging'
$env:FIREBASE_PROJECT_ID = 'fika-os-dev'
$env:FIKA_SNAPSHOT_BUCKET = 'fika-os-dev-staging-read-packages-europe-west4'
npx --no-install tsx scripts/provision-beverage-staging-registry.ts --studio
```

After the owner approves the exact plan, add `--execute` to register the hidden app and publish its current references. Using existing audited AUTHMOD account actions, invite only the approved, already Firebase-bound person. Give Sam the standard assignment to `hospitality-menu-studio` and separate direct organisation `View` and `Manage` grants with empty scope IDs on `hospitality-menu-studio.preview`. The registry's standard action list stays `["View"]`. Record the approved expiry and current access package. The existing Hub [public-safe catalogue package](../../apps/integration-hub/app/api/hospitality-catalogue/public-package/route.ts) still independently requires Hub `canonical.view` for browser sessions. Use access Sam already has or obtain approval for that grant only if the pilot needs catalogue mapping.

## 2. Verify the managed App Hosting and Studio database boundaries

Follow the [permission plan](hospitality-menu-studio-isolation.md) for the standard staging App Hosting role and the conditional Studio draft-author role. Obtain explicit approval for the staging project scope, including shared image repositories, Storage objects and build metadata. Verify effective named-database draft access and denial on default Firestore, production resources, secrets and unrelated service-account credentials. The named database's reviewed deny-all client release was published and verified on 19 November 2026.

With owner approval, set the existing backend environment to `staging` and attach its dedicated account. Update only `environment` and `serviceAccount`, using the current backend ETag. Leave overrides empty, preserve the Git connection, and keep automatic rollouts disabled. Verify the returned backend, branch, traffic, builds and rollouts. [App Hosting backend update](https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends/patch)

## 3. Approve one Studio first release and verify the pilot

From a clean governed checkout, after effective policy and Hub admission evidence are available:

```powershell
npm run fika -- studio-preflight --staging
npm run fika -- deploy menu-studio --staging --sha $studioMergeSha
```

Provide the owner the exact merge SHA, `studioFirstReleaseApprovalHash`, shared staging project exposure, verified data and cross-environment boundaries, and Hub admission evidence. After approval, run:

```powershell
npm run fika -- deploy menu-studio --staging --sha $studioMergeSha --execute --approve-hash $approvedStudioHash --reason $ownerApprovalReference
```

The CLI verifies the custom domain serves the exact build and denies an unauthenticated Studio API call. Sam's authenticated browser acceptance on the custom domain covers create and edit, week copy, reload, conflict and recovery, history, restore and date preview using fictional `DEMO` data. Keep signing, publication, activation, customer booking and operational writes closed during this first pilot. Preserve an ambiguous first rollout's journal for governed recovery. An empty baseline has no prior Studio rollout to restore.

## 4. Extend the pilot through the authorised cross-app path

Refresh and review the authority and consumer increments after #609 integrates. Sequence #596 for CPU allergen evidence and #597 for Hub booking impact before #600 for immutable publication. Keep the scoped amendment and kitchen preview successors (#601 and #605) behind their provider. Review #598's frozen CPU consumer before #604's trusted Hub handoff. #603 overlaps the now-integrated admission and needs reconciliation before any reuse.

Existing Booking and Quote records keep frozen selection evidence. The remaining cross-app cutover must author a Studio publication reference through the trusted Hospitality/Hub booking writer, verify the current signed evidence and commercial offering, then append the canonical Production Order. CPU renders the frozen kitchen version carried by that order. Approve a dedicated staging test booking and its reuse/cleanup procedure separately, with external delivery guarded and real records excluded. A draft save is never a cross-app release.
