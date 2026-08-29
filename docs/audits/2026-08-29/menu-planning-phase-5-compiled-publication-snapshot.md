# Menu Planning Phase 5 compiled publication snapshot

## Executive summary

Publishing remains granular and day-aware, but each successful publication revision now compiles an immutable, self-contained published-week read model. The existing week/day/entry catalogue-reference model remains authoritative for editing. The compiled snapshot carries the published dish names, canonical IDs where available, portions, destinations, planned allergen state and may-contain notes required by downstream consumers.

## Current publish shape before Phase 5

The publish route reads the selected week version, then the selected week/day/entry aggregate. It resolves only referenced catalogue IDs for the normal rolling-menu read path, reads publication state scoped to the source week, and writes the publication root, affected publication day, domain events and transactional outbox entries through `withMenuPlanningTransaction`. It does not intentionally read unrelated weeks or publications for publication itself. Catalogue reconciliation is an explicit pre-publication maintenance step and can read the catalogue according to its existing repository path; the compiled snapshot does not add a catalogue read.

For a week with `D` days, `E` entries and `R` distinct referenced catalogue IDs, the granular shape is: selected week summary/index reads + selected week/day/entry reads + `R` targeted catalogue reads + the selected publication scope and its publication-day/event data. Exact billed counts depend on the backend adapter and existing aggregate shape.

## Snapshot schema and storage

Snapshots use `schemaVersion`, `snapshotId`, `publicationId`, `sourceWeekId`, `sourceWeekVersion`, `publicationVersion`, `publishedAt`, `publishedBy`, `contentHash`, week dates and published days containing publication identity, date, version and complete published entries. Entries preserve canonical dish identity, display name, slot, portions, destinations, allergens and may-contain notes. No images or blobs are included.

Hosted snapshots are stored in `fikaMenuPlanningPublishedSnapshots/{publicationId}:snapshot:v{publicationVersion}`. The publication root keeps the latest immutable snapshot ID as a pointer. Local mode stores the same immutable snapshot map in the existing publication operational document. A known publication snapshot request performs deterministic document reads; it never scans all publications or the catalogue. Legacy publications without a snapshot use a bounded compatibility reconstruction and are not rewritten.

The implementation rejects serialized snapshots over 900 KiB, below Firestore's 1 MiB document limit, before the transaction can commit. Realistic payload size is driven by published entry count and destination/allergen fields; the current model has no images/blobs and therefore fits comfortably for normal populated weeks. The guard protects unusually large data without premature chunking.

## Atomicity, versioning and immutability

Each successful publication day revision increments the publication version and creates a deterministic snapshot ID. The content hash is SHA-256 over the stable snapshot body. Snapshot creation occurs inside the existing publication transaction: publication root/pointer, publication day, snapshot, event and outbox changes commit or fail together. The existing optimistic source-week version check, publication-day supersession rules, idempotency conflict and immutable published-day checks remain in force.

Later catalogue edits, merges, archives or allergen changes do not mutate prior snapshot documents. Published allergen state is copied from the approved publication entry at publication time. Withdrawal affects current operational projection and events; it does not rewrite a historical snapshot.

## API and views

`GET /api/rolling-menu/publications/{publicationId}/snapshot` reads the latest compiled snapshot; `?version=N` reads a specific immutable version. The existing publication APIs remain compatible. Draft and editing screens were not changed to use snapshots. No current Menu Planning screen required a UI redesign; the new API is available for a later history/consumer migration.

## Downstream audit

CPU Production currently consumes the existing publication-day API and relies on its sign-off and publication-day contract, so it was not changed in this phase. Delivered-In and Integration Hub consume existing projections/events/materialisation contracts and were not broadly rewritten. The snapshot is suitable for later low-risk migration of historical published-menu readers, CPU/Delivered-In read projections and client-side publication caching. Existing domain events and outbox delivery are preserved.

## Read/write impact

Before, a published-menu reader reconstructed a menu from publication root + publication days and could separately resolve live catalogue data. After migration to the snapshot API, the reader can use one immutable snapshot document for the published menu payload (or a deterministic pointer plus versioned snapshot lookup when resolving the latest publication ID). Publishing still writes the existing granular publication root/day plus events/outbox and now adds one immutable snapshot write per publication revision. Draft week navigation is unchanged.

No Firestore indexes are required. The only hosted schema addition is the `fikaMenuPlanningPublishedSnapshots` collection and the snapshot pointer/version fields on publication roots. No catalogue delta sync, compiled catalogue work or browser Firestore access was added.
