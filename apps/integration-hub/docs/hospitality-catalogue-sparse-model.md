# Hospitality catalogue: canonical Item + default availability + sparse OPLOC exceptions

Supersedes the Item x OPLOC Offering expansion and the `hospitalityEnabled` OPLOC marker (both withdrawn). Written 2026-10-17.

## 1. Business decisions encoded

1. Every active FIKA OPLOC is Hospitality-capable. "Select all sites" = all active, non-archived OPLOCs (`isActiveCanonicalOploc`, the existing authority).
2. One canonical company-wide Item is **available at every active OPLOC by default**. Nothing is stored to say "available here with company defaults".
3. A stored Offering record is only a **sparse site exception**.

## 2. Model (no new entity types)

| Concept | Storage |
| --- | --- |
| Company Item (name, category, routing, defaults) | `Hospitality Menu Item`; routing record per Item |
| Company default price | Item-scoped `Hospitality Menu Price` (effective-dated) |
| Company default minimum / notice / guests / configuration | `Item.defaultMinimumQuantity`, `defaultNoticeRequiredDays`, `defaultMinimumGuests`, `configuration` (new optional fields) |
| Availability | default everywhere; exceptions via `Offering.available = false` |
| Site price / minimum / notice / wording / config / quote-only / area scope | the same `Hospitality Menu Offering` record, only where it differs |
| Retired record | `lifecycleState: archived` + `retiredReason: item-archived \| redundant-default` (history kept; no effect on availability) |

Rules: an exception equal to the company defaults must not exist (it is retired). Archived Item => no active availability (its records are retired with it and revived on restore). Exception ids are deterministic (`hospitality-menu-offering:site-<sha256(item|oploc)>`) so a concurrent duplicate create collides instead of forking; legacy random ids are kept.

## 3. The one resolver (`lib/hospitality-effective-offering.ts`, client-safe)

`resolveHospitalityOffering(package, itemId, oplocId, {serviceDate, operationalAreaId})` = Item + company defaults + optional exception.
Unavailable when: Item unknown/archived, OPLOC inactive, `available:false`, ambiguous exception, no/ambiguous/malformed price, quote-only record carrying a price. Most specific exception wins (area, then site-wide). The inherited offering key is `hospitality-offering:<itemId>@<oplocId>` (stable, deterministic). Portal read (`hospitalityPortalReadFromRecords`, contract `fika.hospitality-menu-read.v3`), the MNK booking price path and the browser all resolve through this function.

## 4. Offering dependency audit

* Production consumers of Offering records are all inside the Hub: `hospitality-catalogue-service` (portal read), `mnk-booking-catalogue` (booking price authority), the admin read model/commands, canonicalisation, and migration scripts.
* The only downstream consumer outside the Hub is Hospitality Booking `app/api/reference-data/route.ts`, which **passes `offeringId` through** from the portal read and uses `itemId` for identity. No booking, order, quote, production, CPU hand-off, Logistics or audit record persists an Offering id (searched the whole repo). Production routing and CPU hand-off key on the Item id.
* Therefore downstream systems need only an **effective site-specific catalogue entry**, not a physical Offering document. Legacy ids are preserved on retained exceptions; retired records stay in Firestore.

## 5. Migration / compatibility

* `scripts/hospitality-offering-sparse-migration.ts` (read-only by default, production refused): classifies every active Offering as redundant or a genuine exception, identifies the bulk-created default-availability records by **revision evidence + receipt** (never timestamps), lists active records on archived Items, and previews promotion of product-level settings.
* `retireOfferingRecords` (governed, per-record transaction, version- and creator-guarded, receipt-backed idempotent) retires records. Redundant LEGACY records and genuine exceptions are reported only.
* Promotion plan (report only): legacy MNK records carry product-level settings (configuration/choices, notice, guests). `planConfigurationPromotion` shows they promote deterministically onto the Item (staging: 41 Items, 41 deterministic, 0 conflicts); after promotion those records become redundant and retire, leaving the catalogue genuinely sparse.

## 6. Commands (all governed, transactional, version-checked, audited)

`set-site-availability`, `set-site-override` (creates/revives/retires the exception record on demand), `bulk-update` (sites add = clear exceptions, remove = record exclusions, replace = exclude only what is left out; select-all stores nothing), `create-item` (only excluded sites get a record), `set-item-status` (archive retires/restore revives records), `adopt-company-default` (retires records that become redundant).

## 7. Delivery architecture (Firestore is not the read path)

```
Firestore canonical catalogue (admin truth)
  -> compact package: Items once, company defaults once, SPARSE exceptions, active OPLOCs
  -> gzip, content-addressed immutable object  integration-hub/hospitality-catalogue/v<n>-<sha256(gzip)>.json.gz
  -> tiny manifest  { schemaVersion, contentHash, packageVersion, generatedAt, objectName, sizes }
  -> browser: manifest check -> IndexedDB -> resolver
```
* Reuses the platform read-package machinery (hash over the compressed bytes, raw-byte reads with `decompress:false`, manifest + immutable object, integrity fail-closed).
* Deterministic: input order does not matter; an unchanged catalogue keeps the same content identity (no new object, no version bump).
* Invalidation: every successful catalogue mutation (`POST /api/hospitality-catalogue`) rebuilds/republishes the package (coalesced, best-effort, reported as `package: published|unchanged|stale`); `POST /api/hospitality-catalogue/package` is the explicit admin rebuild. A GET never rebuilds.
* Endpoints: `GET /api/hospitality-catalogue/package` (manifest, 0 Firestore reads) and `GET .../package/<hash>` (immutable raw gzip, `Cache-Control: immutable`). Bridge token or Hub session.
* Browser (`lib/hospitality-catalogue-client.ts`): cache record = `{clientSchemaVersion, packageSchemaVersion, contentHash, generatedAt, catalogue}`. Hit iff schema + hash match. Schema mismatch / damaged / unreadable cache is ignored and replaced; a schema bump drops the IndexedDB store. Manifest unreachable + valid cache => returned flagged `cache-unverified`, never as current. **Normal startup = 1 manifest request + 1 IndexedDB read; 0 Firestore reads; the package is downloaded only when the content hash changes.**
* Historical bookings keep their own snapshots; an older package still resolves for the history it describes.

Staging preview (46 Items x 19 OPLOCs): 874 naive combinations, **42 exceptions**, 41 KB JSON, **7.2 KB gzip**.

## 8. Known limitations / next steps

* Product-level settings still live on the 42 legacy MNK exception records until the (approved-separately) promotion migration runs; until then other sites inherit price but not choices/notice. Booking portals for non-MNK sites must not go live on the new package before promotion.
* Hospitality Booking still reads the portal contract (v3 shape-compatible); switching its client to the package loader is a staged follow-up behind the same resolver.
* OPLOC redirect (historical id) resolution stays with the Hub/AUTHMOD authority; the package contains canonical active OPLOC ids only.
