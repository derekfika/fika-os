# 2026-11-05 — Reset Week and occupied Monday protection (#332)

Reset Week now submits the observed week version through the operational transaction, clears draft placements while preserving week provenance and custom-slot metadata, and rejects published or otherwise locked weeks. Start Blank Week disables occupied Mondays, reuses an existing empty shell without overwriting it, and rechecks occupancy atomically on submission.

Validation: focused rolling-menu tests (51 passed); full Menu Planning tests serialised (513 passed, 4 skipped); typecheck, production build, and changelog validation passed. The default parallel test invocation had one unrelated catalogue-fixture race; serial execution passed.
Deployment: none.
