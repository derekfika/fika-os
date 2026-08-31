# Menu Planning immutable read-package staging readiness

Status: preflight only. No deployment, bucket creation or IAM mutation was performed.

## Findings

| Fact | Repository evidence / result |
|---|---|
| Firebase/GCP project | `fika-os-dev` in `apps/menu-planning/apphosting.staging.yaml`; `gcloud config get-value project` also returned `fika-os-dev`. |
| App Hosting backend | Not discoverable from this environment. The Firebase CLI returned `Unable to list backends present for project: fika-os-dev`; the installed gcloud lacks the App Hosting command group. The exact backend name therefore remains a cloud/operator fact. |
| Region | Not present in repository and not discoverable with the installed CLI. Must be read from the backend resource. |
| Runtime identity | Not present in repository and not discoverable with the installed CLI. Must be read from the backend resource / App Hosting runtime service account. Do not infer it. |
| Current package store | Local mode: filesystem under `FIKA_SNAPSHOT_DIR` or `apps/menu-planning/local-data/read-packages`. Staging/production: Google Cloud Storage through `firebase-admin/storage`. |
| Required hosted configuration | `FIREBASE_PROJECT_ID` (or `GCLOUD_PROJECT`) and `FIKA_SNAPSHOT_BUCKET` (or `FIREBASE_STORAGE_BUCKET`). |
| Package contract | Shared `@fika/server-shared/read-package`: immutable gzip object, SHA-256 content hash, manifest pointer, package/schema/contract/source versions and record counts. |
| Durable runtime storage | Local App Hosting filesystem must be treated as non-durable. Hosted staging is not ready until a durable bucket and runtime identity are confirmed. |

The generated local files under `apps/menu-planning/local-data/read-packages/` are now excluded by a narrow `.gitignore` rule. They are local generated artefacts, not deployable source or an authoritative data store.

## Minimum IAM

The runtime principal needs the least-privilege equivalent of:

- retrieve package objects and manifests: `storage.objects.get`;
- publish new immutable package objects: `storage.objects.create`;
- verify object existence: `storage.objects.get` or `storage.objects.list` depending on the chosen implementation;
- update the current manifest pointer: `storage.objects.create` (the manifest is replaced as the latest pointer).

The implementation does not require bucket creation, object deletion, ACL administration, IAM administration, or broad project administration. Exact predefined/custom role selection must be made by the cloud owner after the bucket and runtime principal are known. Existing IAM state was not verifiable here.

## Operator discovery commands

Run from an authenticated operator environment with the Firebase App Hosting component installed:

```powershell
firebase apphosting:backends:list --project=fika-os-dev
firebase apphosting:backends:get <BACKEND_ID> --project=fika-os-dev
gcloud storage buckets list --project=fika-os-dev
gcloud storage buckets describe gs://<BUCKET> --project=fika-os-dev
gcloud projects get-iam-policy fika-os-dev --flatten="bindings[].members" --filter="bindings.members:serviceAccount" --format="table(bindings.role,bindings.members)"
```

The backend details must supply the exact backend ID, region and runtime service account. Confirm the bucket name explicitly; do not create one as part of this change.

## Staging sequence once cloud facts are confirmed

1. Confirm the backend root is `apps/menu-planning`, project is `fika-os-dev`, and the exact staging backend uses the checked-in staging configuration.
2. Confirm or provision the approved bucket through the cloud release process, then set `FIKA_SNAPSHOT_BUCKET` on that backend. This change does not provision it.
3. Grant only the minimum object read/create permissions above to the actual runtime principal, if missing.
4. Run the package publication/bootstrap action from an authenticated operator environment. The current implementation bootstraps on the first catalogue read; an explicit operator publication command should be added before production promotion if a no-first-request bootstrap is required.
5. Verify the manifest object and immutable gzip object exist, then validate the manifest hash and decompressed payload.
6. Deploy only after approval with the project’s App Hosting release workflow. The exact command shape is:

```powershell
firebase apphosting:backends:deploy <BACKEND_ID> --project=fika-os-dev
```

The exact backend ID and approved release ref must replace placeholders; they were intentionally not guessed.

## Post-deployment checks

- cold request publishes or retrieves a manifest and validates the object hash;
- warm request reads the immutable package and emits `source: SNAPSHOT` tracing;
- deleting/withdrawing a source catalogue item produces a new package version rather than mutating an old object;
- missing bucket configuration fails with `SNAPSHOT_STORAGE_NOT_CONFIGURED`;
- no package object or generated local file is treated as canonical catalogue authority;
- Cloud Monitoring confirms object reads/writes and Firestore reads before estimating savings.

## Blockers requiring human/cloud action

The exact App Hosting backend identity, region, runtime principal, bucket, and current IAM bindings remain unresolved because authenticated App Hosting discovery is unavailable in this environment. No safe deployment or IAM recommendation can name those values until an operator supplies them from the commands above.
