# Hospitality Rotations UI integration

The `/rotations-preview` page remains a development-only fixture demonstration. The authenticated `/rotations` page is the live manager and never loads fixture data.

## Authority and access

The server page forwards the signed-in FIKA session to Hub and requires the separate AUTHMOD `View`, `Manage`, and `Publish` capabilities. Hub remains the authority on every read and write. The Hospitality API route is a session-preserving, `private, no-store` proxy; it does not grant permissions or apply business rules.

The manager obtains the current draft/head from Hub and canonical Dish Library and Hospitality Item choices from the protected `mode=resources` endpoint. The Hub endpoint requires `Manage`, reads the Dish Library manifest once per page request, validates its current package identity and gzip integrity, and returns only dish ID, name, category and recipe revision. It returns only ID/name/category for canonical Hospitality Items. It does not rebuild a package during GET, expose recipe or allergen evidence, or serve fallback fixtures when resources are unavailable.

## Manager workflow

The screen supports initial configuration, group creation, canonical Item assignment, Dish Library selection, six-week planning, category and quantity/guest rules, draft save with the aggregate version, published revision review, seasonal draft preparation from a published version, and a reviewed publication with effective date and reason. Hub provides optimistic concurrency, idempotency, immutable revisions and provider snapshots. Published menu history and existing production-order snapshots remain unchanged.

## Current boundaries

The provider contract does not offer group deletion, withdrawal or rescheduling; the UI does not expose these operations. Dish and Item resources must be available as current integrity-checked packages. A stale/missing package fails closed and requires its owning producer's normal repair workflow. Browser-side search filters the bounded resource list in memory; it makes no per-keystroke reads.

UI uses the existing light operational surface and semantic style classes. Style Guide compliance: PASS.
