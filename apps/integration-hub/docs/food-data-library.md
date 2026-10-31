# Food Data — Kafoodle Product & Recipe Libraries

Read-only, staging-only Integration Hub feature at `/food-data`. It is isolated from every operational workflow: it
reads no Firestore catalogue data, writes nothing, and nothing consumes it. It is not part of the canonical Dish Library.

## Source and versioning

The private bucket `gs://fika-os-dev-kafoodle-catalogue-europe-west4`, prefix `kafoodle/v1/2026-10-31/`, holds
`manifest.json`, `ingredients.json.gz` and `recipes.json.gz`. The manifest is a **fixed snapshot**, not a publication
pointer: the prefix is pinned in configuration (`FIKA_FOOD_DATA_PREFIX`), nothing writes or looks up a "latest",
and nothing is rebuilt on GET. A future quarterly import means uploading a new prefix and changing that setting.

Each dataset has its own version, `<snapshot>:<gzipSha256>`, so recipes and ingredients change independently.
Payloads are `{ schemaVersion, dataset, snapshot, columns, rows }` where each row is a positional array of strings
indexed against `columns`. Columns are resolved by header name; a missing required column fails loudly.

## Delivery and integrity

| Step | Endpoint | Notes |
| --- | --- | --- |
| Manifest check | `GET /api/food-data/manifest` | One small object read; returns the manifest and the caller’s identity scope. |
| Bundle | `GET /api/food-data/bundle/<dataset>?version=<version>` | Same-origin, authenticated, `private, no-store`. 409 if the version has moved. |

The server verifies the stored object’s size and SHA-256 against the manifest before sending, and sends the **exact
stored gzip bytes as `application/gzip` without `Content-Encoding`**. That keeps the transfer compressed (≈1.6 MB for
products, 26 KB for recipes) while stopping the browser transparently inflating it, so the client can hash the gzip bytes
(`gzipSha256`), decompress with a size cap, hash the JSON (`jsonSha256`) and validate row/column counts. Bundles are
buffered (≤ 1.6 MB) rather than streamed so a corrupt object is never sent. No signed URLs are used: the bytes never
leave the origin and no browser credential exists.

## Access model

- Who: any signed-in, **active person** (staff) account. The existing Hub Firebase session cookie is verified and resolved
  through AUTHMOD to an active person identity; there is **no Food Data–specific grant or permission**. Shared
  operational/site accounts, inactive or unenrolled identities and signed-out callers are refused (403/401).
- Food Data access does not widen anything else: it grants no Hub administration, AUTHMOD, canonical-record or other app access.
- The bundle includes VAT-inclusive pack prices; there is no separate unpriced view.
- Per request: the normal session verification and identity read only (existing AUTHMOD reads). **No grant lookups and zero
  catalogue Firestore reads or listeners.** Authentication happens before any bucket read; refused callers cause none.
- Environment: enabled only when `FIKA_RUNTIME_MODE` is `staging` or `local`, and never in production.
  `FIKA_FOOD_DATA_ENABLED=false` is a kill switch. Cross-site fetches (`Sec-Fetch-Site`) are refused.
- Local development can read a copy of the export from `FIKA_FOOD_DATA_LOCAL_DIR` (local mode only) instead of GCS.

### Required GCS permission (review before granting; no IAM was changed)

The Hub runtime service account needs only `storage.objects.get` on this bucket (no list, create, update or delete).
The predefined role carrying it is `roles/storage.objectViewer`, which also includes list; a bucket-scoped custom
role with just `storage.objects.get` is the narrowest option. The code never lists the bucket.

## Browser cache (IndexedDB)

Database `fika-food-data-cache`, store `bundles`, one record per `environment | identity | dataset` holding the verified
gzip bytes, its manifest entry and version. Behaviour:

- Each visit makes **one manifest request** (this is also the live authorisation check). Cached rows are only decoded
  after it succeeds. 401/403/404 clears the local copy and shows nothing; an outage alone shows nothing and keeps the cache.
- A bundle is downloaded only when its version differs from the cached one; the other dataset is untouched.
- Reads re-verify both hashes, so corrupt or tampered records are discarded and re-downloaded.
- Replacement happens only after the new bytes verify, in a single put; a failed write keeps the old record.
- If a download fails transiently after access was just confirmed, the last-known-good snapshot is shown with a warning.
  Integrity failures never fall back.
- Other identities’/environments’ records are purged on load; logout (Launcher) clears everything.
- Quota or unavailable IndexedDB degrades to in-memory use with a visible notice. Concurrent loads share one request.
- Authorisation decisions are never cached.

## UI

Light, token-based page with two tabs (Product & Supplier Library, Recipe Library), windowed lists (about 35 DOM rows
for 14,007 records), keyboard navigation and text status badges. Prices are labelled VAT-inclusive as exported;
ex-VAT and per-kg/per-litre costs are labelled calculated and only produced for g/kg/ml/l units with a numeric
quantity. Blank allergen blocks are “not recorded”, never “clear”. Recipes are labelled metadata only; exact-name
groups, exact duplicate rows and differing fields are shown, never merged. The launcher shows a Food Data tile to every
signed-in person account (not to shared operational accounts); the tile only links to `/food-data`.

## Deliberately not included

No delta protocol, background sync, scheduler, notifications, supplier API calls, Firestore documents, recipe
costing or Beverage Innovation workflow. Pack prices have **no known price-effective date**.
