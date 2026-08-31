# Immutable read-package deltas design

Status: design only. No runtime delta implementation is included.

## Recommendation

Keep the current full immutable gzip/SHA-256 snapshot as the baseline. Deltas are optional and dataset-specific. For small datasets such as roughly 23 OPLOCs, publish a replacement compressed snapshot: the complexity and recovery cost of a delta chain will usually exceed the bandwidth saved. Use an operational consumer projection for Delivered-In day data rather than turning a small reference package into a delta stream.

## Contract shapes

```ts
type SnapshotManifest = ReadPackageManifest & {
  kind: "snapshot";
  sourceVersion: string;
  stateHash: string;       // hash of canonical uncompressed logical state
  predecessor?: { packageVersion: number; stateHash: string };
};

type DeltaManifest = {
  dataset: string;
  kind: "delta";
  packageVersion: number;   // one global monotonic package sequence
  basePackageVersion: number;
  targetPackageVersion: number;
  baseStateHash: string;
  targetStateHash: string;
  schemaVersion: number;
  contractVersion: string;
  objectName: string;
  compression: "gzip";
  contentHash: string;      // hash of compressed delta bytes
  recordCount: number;
  generatedAt: string;
  sourceVersion: string;
};

type DeltaOperation =
  | { op: "upsert"; id: string; value: unknown }
  | { op: "delete"; id: string };
```

`packageVersion` is governed immutable identity; timestamps are metadata only. A delta is valid only for its exact base package version and logical state hash. Deltas contain no grants, access decisions or authority state.

## Publication and naming

Keep the existing object naming convention for snapshots and add a distinct dataset-scoped path:

```text
<dataset>/snapshots/v<packageVersion>-<compressedHash>.json.gz
<dataset>/deltas/v<base>-to-v<target>-<compressedHash>.json.gz
<dataset>/manifests/latest.json
```

The manifest remains the only latest pointer. Build and validate the complete target state, write the immutable delta, verify it, then atomically publish the manifest. A full snapshot and delta may coexist; old objects are never overwritten.

## Client algorithm

1. Read the bounded manifest.
2. Reuse the local state only when dataset, schema/contract version and state hash match.
3. If the client state is a known base, follow contiguous deltas whose `basePackageVersion` equals the current version.
4. Verify each compressed hash, operation ordering and base hash before applying; apply operations to a copy.
5. Verify the resulting canonical state hash and target version before IndexedDB installation.
6. If any delta is missing, corrupt, out of order, too long, schema-incompatible or based on a different state hash, discard the partial result and fetch the latest full snapshot.
7. Install the validated state and manifest together in one IndexedDB transaction. Never expose a partially applied chain.

The server still performs AUTHMOD/access evaluation on every protected request. A cache key may include account/access scope, OPLOC and date, but it is never an authority source.

## Limits and compaction

Recommended initial policy:

- maximum chain length: 3 deltas;
- compact when the delta chain exceeds 3, or compressed delta bytes exceed 35% of a fresh compressed snapshot;
- compact immediately after a schema/contract change, rollback, or source restatement;
- retain the current full snapshot plus enough predecessors/deltas for the supported client age, with domain-owned retention and no deletion before the recovery window;
- regenerate a full snapshot after any failed or unverifiable delta publication.

For packages under 64 KiB compressed or datasets under 100 records, default to full snapshots. Consider deltas only when the measured median delta is below 35% of the replacement snapshot and the dataset has a sufficiently high update/read ratio to amortise the implementation and validation cost.

## Failure and recovery matrix

| Condition | Behaviour |
|---|---|
| Missing delta | Fetch latest trusted full snapshot. Keep last valid local state only if UI can label it stale. |
| Compressed hash failure | Reject delta, emit integrity telemetry, fetch full snapshot. |
| Base/state hash mismatch | Reject chain; never attempt fuzzy merge. |
| Skipped version | Reject chain unless a manifest explicitly supplies every contiguous link. |
| Very old cache | Fetch full snapshot; do not replay unbounded history. |
| Schema/contract change | Fetch compatible full snapshot; invalidate incompatible IndexedDB rows. |
| Tombstone | Apply deterministic delete by stable ID; retain tombstone in the delta until all supported bases pass the retention window. |
| Duplicate operation/retry | Publication IDs and target version make retries idempotent; client replays only an exact expected base. |
| Failed publication | Leave the prior manifest unchanged. |
| Rollback | Publish a new governed snapshot/version whose source lineage explicitly references the rollback; never repoint to mutable data or reuse a version. |

## Server compaction algorithm

Read the last trusted full state, apply source changes in stable ID order, calculate the target state hash, and generate deterministic operations sorted by stable ID and operation kind. Validate that applying operations to the exact base produces the target hash. Publish the delta only after object verification. When a threshold is reached, publish a new full snapshot and make it the manifest base. Reconciliation must be able to rebuild a full snapshot from canonical authority without depending on retained deltas.

## Dataset recommendations

| Dataset | Recommendation |
|---|---|
| Integration Hub OPLOC reference package | Full snapshot only initially; small and security-sensitive. |
| Menu Planning catalogue | Full snapshot by default; measure before considering deltas. |
| Delivered-In OPLOC/day projection | Projection package, not generic reference deltas; day identity and freshness matter more. |
| CPU/Logistics operational projections | Dataset-specific projection changes may be appropriate later, but only with explicit event/version lineage and rebuild paths. |

## Telemetry

Record dataset, base/target versions, compressed full and delta bytes, operations, chain length, apply duration, integrity failures, fallback reason, cache age and whether the full replacement would have been smaller. Compare p50/p95 bytes and latency by cold/warm path; do not assume a lower payload is a lower total cost.

## Likely implementation phases and files

1. Add a shared delta contract and deterministic operation/hash helpers beside `packages/server-shared/src/read-package.ts` only after the contract is accepted.
2. Add dataset-owned publication/rebuild logic and thresholds in each consumer package module (`apps/integration-hub/lib/oploc-read-package.ts`, `apps/menu-planning/lib/catalogue-read-package.ts`, and any later operational projection module).
3. Add client installation/recovery helpers beside each IndexedDB cache, with transaction-level tests.
4. Add bounded retention/compaction jobs and reconciliation commands.
5. Add Cloud Monitoring dashboards and measured rollout gates.

Required tests include deterministic operation ordering, upsert/delete/tombstone semantics, base/target hash validation, missing/corrupt/out-of-order recovery, schema invalidation, retry idempotency, rollback, retention, IndexedDB atomic installation, AUTHMOD independence, and a size comparison proving that a delta is actually cheaper than a replacement gzip snapshot.
