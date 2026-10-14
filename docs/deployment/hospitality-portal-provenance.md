# Hospitality portal provenance — validated implementation and staging preparation

Task date: 2026-10-14. Branch: `codex/hospitality-portal-provenance`.

Phase 3 follows the accepted analysis in `docs/ai/HOSPITALITY-SOURCE-PROVIDER-ANALYSIS-2026-10-14.md`, with the user's clarification that RCoA retains its existing provider. This document records preparation; no staging governance commands or deployments were executed by this task.

## Identity and provenance contract

`apps/integration-hub/lib/hospitality-booking-identity.ts` owns the explicit frozen identity boundary:

- `portalBookingIdentity(sourceBookingId, portalSiteId)` returns `{ canonicalId, scheme, namespace }`.
- `calendarBookingIdentity(sourceBookingId, legacySiteId)` independently defines Calendar's existing namespace selection.
- `scheme` is `fika.booking-identity.legacy-v1`.
- `namespace` is the literal historical hash salt `mnk-booking-platform` or `rcoa-booking-platform`. This is an identity namespace, not the current provenance provider.
- Identity remains `SHA256(namespace + ':' + sourceBookingId.trim()).slice(0, 32)`, with the existing `booking:mnk:` or `booking:rcoa:` prefix. No new hash salt or site component is introduced.
- New canonical records carry optional-compatible `source.identity = { scheme, namespace }`. Historical records need no new field.
- The legacy `canonicalBookingId` accessor delegates to this boundary; it never reads `source.provider`.

| New ingress | `source.provider` | Identity namespace | Accepted payload contract |
| --- | --- | --- | --- |
| MNK / Angel Court / CFC / Munich Re portal | `hospitality-booking-platform` | `mnk-booking-platform` | Existing `fika.booking-ingestion.mnk.v1` wire adapter |
| RCoA portal | `rcoa-booking-platform` | `rcoa-booking-platform` | `fika.booking-ingestion.rcoa.v1` |
| Calendar importer | Existing MNK/RCoA attribution, unchanged | Existing selection, unchanged | Existing wire adapter, unchanged |

The MNK-shaped payload contract and legacy Hub route remain compatibility interfaces. Their names do not control new provenance. Menu providers remain `mnk-booking-platform`, `angel-court-hospitality-brochure`, `cfc-hospitality-brochure`, `munich-re-generic-brochure` and `rcoa-hospitality-brochure` respectively.

`buildHospitalityPortalBooking` and `ingestHospitalityPortalBooking` are the explicit portal adapters. Hub's authenticated `/api/bookings/mnk` route now calls the latter. Compatibility exports retain old helper names for existing portal callers.

`buildCalendarCanonicalBooking` and `ingestCalendarBooking` retain Calendar's compatibility policy. The Calendar scanner now calls this wrapper. Its `calendar:cpux@fikacatering.com:<eventId>` references, namespace, provider and legacy mapping policy remain unchanged. Portal ingress rejects reserved Calendar references. The scanner itself, Google APIs and shared UAT state were not exercised or mutated.

## Retry behaviour

The transaction computes the frozen identity and directly reads that Booking **before reading catalogues or new source mappings**. Existing records are returned unchanged with `created: false`: original provider, original payload, identity-field absence, commercial/quote state and audit remain intact. No new Booking/audit/notification is written.

For `ANGEL-ONE`, both old and new portal code resolve `booking:mnk:69a1b189cf46d80637fbe8663f2c23b3`. A new record carries the shared provider; an existing MNK-era record retains its historical provider. New MNK `MNK-ONE` retains `booking:mnk:a60b2ecb2b226c4d56b61460830a38a6`. RCoA's pinned golden identity is also unchanged.

The existing non-RCoA namespace is shared across sites. If a reused reference resolves to another site's Booking, ingestion rejects with 422 instead of returning it or creating another identity. Stored legacy site context can be recovered from the immutable original payload when needed. A label can support historical retry interpretation; new creation requires a recognised stable portal key. Unresolvable historical scope fails closed rather than guessing. No record is rewritten to resolve a collision.

Production requirement/order/line IDs, quote revision IDs and notification dedupe keys still depend on the unchanged canonical Booking ID. No production, quote, release or historical audit migration is required. General BookingPortal's pre-existing generation of a fresh reference per fresh submit attempt remains unchanged; server idempotency applies to replay of the same source reference. This task does not claim to fix uncertain-response retries that generate a different reference.

## Governed destination resolution

New shared portal creation requires exactly one confirmed tuple:

```text
sourceProvider = hospitality-booking-platform
sourceEntityType = provider-location
sourceIdentifier = stable portal site key
```

The target must resolve to an active canonical OPLOC. Wrong provider/type/key, absent/ambiguous mapping, missing/wrong-type/archived/withdrawn target fail closed before Booking/audit/outbox writes. Display labels are preserved in the Booking, but new creation does not use them for OPLOC lookup. RCoA's stable-key/equality policy remains unchanged. Calendar retains its pre-existing mapping compatibility policy.

Cold creation retains the existing bounded menu query (maximum 500), reads mappings only for the submitted identifier with a maximum 100-record bound, and directly reads the selected OPLOC. MNK additionally reads only submitted item offerings/prices, as before. Replay reads one Booking and writes nothing. No new composite query index, listener or periodic workload is added.

## Staging governance changes required — not applied

All mutations must use authenticated `POST /api/governance` on staging Hub, with its real actor session. Do not use Admin SDK/Firestore writes for these decisions. The same authenticated governance API atomically writes each current mapping projection and its durable audit decision.

First create and verify these **four** mappings. RCoA's provider remains unchanged, so no new RCoA mapping is required:

| Stable identifier | Source label | Canonical target |
| --- | --- | --- |
| `mnk` | MNK | `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` |
| `angel-court` | One Angel Court | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` |
| `cfc` | CFC | `oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e` |
| `munich-re` | Munich RE | `oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701` |

Each command uses this shape, substituting the table's identifier, label and OPLOC:

```json
{
  "action": "source-mapping",
  "sourceProvider": "hospitality-booking-platform",
  "sourceEntityType": "provider-location",
  "sourceIdentifier": "angel-court",
  "sourceLabel": "One Angel Court",
  "oplocId": "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10",
  "mappingStatus": "confirmed",
  "decisionReason": "Confirm the shared Hospitality application's stable portal key against the existing governed OPLOC. Application provenance is separate from the retained legacy Booking identity namespace."
}
```

Verify exact tuple, target, version, confirmedBy/confirmedAt and new governance audit actor/action/entity/time. These mappings may be prepared before deployment: the old non-RCoA resolver accepts additional confirmed mappings to the same existing canonical targets. Do not create a second `rcoa` mapping: its existing resolver requires a unique provider-location candidate.

After deploying the validated exact SHA and confirming shared-portal staging submissions/load/review, supersede the two mistaken Angel Court mappings through two governance decisions:

| Mapping ID | Existing provider/type/identifier | Required status |
| --- | --- | --- |
| `source-mapping:c1a07263c6990c7c0ca1f5f6` | `mnk-booking-platform` / `site-label` / `angel-court` | `historical` |
| `source-mapping:3a2beedeb1ebeba8897618b9` | `mnk-booking-platform` / `site-label` / `one angel court` | `historical` |

Use `action: source-mapping`, the original provider/type/identifier, the same Angel Court `oplocId`, `mappingStatus: historical`, and a decisionReason citing the old mapping ID, its original audit and the replacement `hospitality-booking-platform/provider-location/angel-court` decision. This updates the existing projection to version 2 and appends audit; it does not delete a record or rewrite the original audit. Governance clears current confirmation fields when a mapping is historical; the original confirmation remains in durable audit evidence.

Preserve `rota/site-label/angel court` (`source-mapping:790693b3a54fddcf4a74f0c7`) and all other historical source mappings, including existing RCoA. `one angel court` is a display label; the new stable-key mapping records it as `sourceLabel`. It does not require an additional active label-based destination mapping.

## Validation

- Focused Hub identity, ingestion, Calendar, projection-boundary, MNK pricing, notification and workflow tests: 60 passed.
- Isolated Firestore regression: 10 passed, including concurrent replay for all five sites, historical retry without new mapping, fail-closed writes, Calendar compatibility, review/quote/Production handoff and outbox identity.
- Existing Firestore lifecycle/outbox worker tests: 2 passed against the same separate disposable emulator after clearing only that scratch database.
- Full Hospitality suite: 103 passed.
- Hub and Hospitality `npm run typecheck`: passed. The first Hub check exposed a missing `synthetic` field on the new test actor; corrected before the successful check and builds.
- Hub and Hospitality `npm run build`: passed.
- `git diff --check`: passed.

The emulator was a separate `demo-fika-os` instance at `127.0.0.1:18985`, with its configuration/logs under a temporary directory, not the standard `8085` UAT instance. The new integration test is opt-in and asserts local runtime, that exact isolated host/project, and a fresh Booking collection before seeding. No CPU reuse UAT, staging or production state was changed. No actual email/Drive/CPU external call was made; the production handoff test invokes the internal domain boundary and asserts persisted identity.

Reproduce the new integration regression with a fresh Firestore emulator on that separate port/project, then set `FIKA_RUNTIME_MODE=local`, `FIREBASE_PROJECT_ID=demo-fika-os`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:18985`, `FIKA_HOSPITALITY_IDENTITY_TEST_EMULATOR=true` and run `tsx --test tests/hospitality-source-identity-firestore.test.ts` from the Hub app. The other focused tests run without the opt-in flag.

## Deployment decision and remaining scope

**GO for the coordinated staging rollout after the four governed mappings are prepared and verified. NO-GO for deploying into the current unprepared mapping state:** new submissions for the four shared-provider sites would correctly fail closed until those mappings exist. Historical same-reference retries remain usable without the new mappings. RCoA retains its existing behaviour.

No broad booking backfill, provider rewrite, Production Order rewrite, quote/release/history rewrite or new OPLOC is required. Remaining operational work is authenticated mapping preparation, exact-SHA staging deployment, live submission/read/review verification and audited retirement of the two mistaken mappings. This task stops before all staging data mutation and deployment. Production deployment and main merge remain prohibited.
