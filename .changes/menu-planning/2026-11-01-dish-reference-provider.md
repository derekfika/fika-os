# 2026-11-01 — Preserve historical dish references through catalogue replacement

The scoped Week Planner read now includes versioned dish-reference metadata for active, archived, verified merged and unresolved IDs, preserving saved dish labels, IDs, slots, quantities and published evidence. New selections still use the active catalogue. Archived and merged metadata is read through exact document IDs and hash-verified immutable archive/mapping indexes; absent or damaged evidence never invents a successor. This introduces no migration writer or data change.

Read cost: for N distinct visible saved IDs, the previous lookup read N catalogue documents; this provider reads those same N documents plus two exact source manifests. The two uncached manifest reads bind the records and historical evidence to a stable source revision/hash; reusing a TTL-cached manifest could conceal a concurrent cutover and is unsafe here. Existing catalogue manifest reads have no cross-request cache to reuse. Cold and warm server requests therefore have the same bounded cost; no new background refresh or polling is added, and the existing week/client cache lifecycle is preserved.

A configured historical-reference manifest adds one exact archive-root read, A requested archived records, M requested mapping records and S unique one-hop survivors (each A/M/S <= N, documents fetched in batches of 100). No catalogue, archive or successor collection is scanned. Blank weeks perform no reference reads. No per-read audit documents are written; existing technical source-meter counters report the bounded reads.

Validation: focused reference/route tests, Menu Planning suite, typecheck, production build and governed validation recorded in the PR. Cutover payload, live archive/readback, staging isolation and write-path UAT remain separate gates.

Deployment: none. Production/staging data and legacy platforms unchanged.
