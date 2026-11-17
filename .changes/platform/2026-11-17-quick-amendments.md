# 2026-11-17 — Preserve Menu allergen evidence lineage

The shared external Production Order contract carries the canonical ingredient/recipe and allergen evidence fingerprints from Menu Planning to CPU. Historical artifacts and CPU matrix hashes retain their existing identity; the fingerprint is evaluated as separate source signing lineage.

Validation: Hub contract and CPU lineage tests; shared package fan-out, typechecks and builds recorded with task validation.
Deployment: none; staging release requires the merged exact source.
