# Integration Hub reference cache

The browser cache is a performance-only IndexedDB snapshot. It is never used
to authorize a read or mutation; AUTHMOD, the session and server-side grants
remain authoritative, and the browser never calls Firestore.

The `fika-integration-hub-cache` database uses schema version `1`. Its stores
are `cacheMetadata`, `canonicalOplocs`, `legends`, `applications`,
`serviceDefinitions`, `equipmentAssets` and `referenceEntities`. Records are
keyed by deterministic dataset/ID values and snapshots carry the runtime
origin and AUTHMOD identity scope. A future incompatible shape increments the
database version and the upgrade handler may add stores; an incompatible
deployment can clear the cache without affecting server-backed operation.

Manifests live in the server-side `integrationHubCacheManifests` collection,
one document per dataset. Canonical writes bump the applicable manifest in the
same Firestore transaction. Missing manifests are version zero, so the first
use safely hydrates the requested dataset. No short TTL is used: a manifest
check controls freshness, with browser storage persisting across restarts.

Connections uses stale-while-revalidate: a cached overview renders first, then
the small per-dataset manifest request runs in the background. If unchanged,
the overview is retained; if changed, the authoritative Connections endpoint
rebuilds it. Manifest failures preserve the valid cached view. IndexedDB,
quota, private-mode and malformed-cache failures fall back to the server.

AUTHMOD application visibility and grants are deliberately not cached. Logout
clears identity-scoped reference snapshots and metadata. A future Windows
bootstrap package can safely pre-seed the same database by importing records
under the documented schema version, runtime origin, identity scope and
server-issued manifest versions; it must never seed grants or use the cache to
make access decisions.

## Dataset audit and read shape

| Dataset | Current authority | Classification | Cache scope | Partial refresh |
| --- | --- | --- | --- | --- |
| OPLOCs | `integrationHubCanonical`, `entityType == OPLOC` | Low-churn canonical reference | Identity + origin | Yes, by dataset or known ID |
| Legends and Employment evidence | `integrationHubCanonical` | Low/moderate churn reference; employment is retained evidence | Identity + origin | Yes, by dataset |
| Service Definitions | `integrationHubCanonical` | Low-churn reusable reference | Identity + origin | Yes |
| Equipment Types/Assets | `integrationHubCanonical` | Low/moderate churn reference | Identity + origin | Yes |
| Capabilities/Staffing Roles | `integrationHubCanonical` | Reference data, with governed writes | Identity + origin | Yes |
| AUTHMOD applications, grants, assignments and identities | AUTHMOD collections | Security-sensitive; not cached | Server only | Targeted server reads |
| Staging, imports, audits, bookings, production and logistics state | Their authoritative stores | Transactional/dynamic; not long-lived cached | Server only | Existing bounded APIs |

Cold Connections navigation performs the session check, one authoritative
Connections read, and small manifest reads while seeding the cache. Warm
navigation renders the cached snapshot immediately, performs one bounded
multi-dataset manifest request, and performs zero full Connections reads when
the versions are unchanged. A changed manifest currently refreshes the
authoritative Connections projection as one coherent response; the dataset
endpoints are available for future screen-specific partial hydration and
known-ID lookup without making a cache miss a whole-registry scan.

The launcher still performs its normal session and AUTHMOD access evaluation.
Its app visibility is not inferred from the cache. Therefore the launcher
read shape remains bounded authorization plus the launcher’s application
registry/access reads; this is deliberate because app/site grants are not safe
to treat as a client cache.
