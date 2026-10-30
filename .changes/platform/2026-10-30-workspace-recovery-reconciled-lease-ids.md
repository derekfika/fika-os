# 2026-10-30 — Stacked recovery tolerates reconciled historical lease IDs

`workspace recover-stacked` refused every preview when two historical leases shared an ID
(for example `hospitality-rotations-integration-v2`/`-v3`, created when reconcile copied the
source lease into its replacement). A shared ID is now accepted only for exactly one pair
proven by a committed, checksum-verified reconciliation journal: matching owner and ID,
mutually cross-referenced leases, superseded source and terminal replacement. Active
duplicates, third records, unrelated or owner-mismatched records, and missing or tampered
journals still fail closed. Historical leases and journals are not edited; preview hashing,
locks, exact-ID selection, preservation and one-lease revocation are unchanged.

Validation: recovery regressions (historical pair positive case plus negative cases) and
related workflow tests; see the PR for exact-source CI. The read-only registry check
accepts the real registry. #128 recovery was not previewed or executed.
Deployment: none.
