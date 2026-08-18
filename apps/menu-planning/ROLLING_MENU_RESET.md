# Delivered-In Menu Planning reset

The primary Menu Planning workflow is now the rolling weekly menu workspace. It is intentionally centred on the current week, daily operational slots, destination allocations, explicit allergen declarations and publish readiness.

The reset did not delete source workbooks, provenance, parser code, audit infrastructure or valid domain records. The old catalogue/source material remains available as evidence and setup infrastructure; it is not rendered as the operational menu. Historical workbook imports are stored as durable week snapshots and retain workbook, sheet and raw-row provenance. Re-importing a week is idempotent and a workbook with no recognised entries cannot replace an existing week.

Imported material is not silently promoted into a reusable catalogue. A dish can be used in a planned occurrence with its original source label while canonical reconciliation remains an explicit follow-up decision. Allergen values are preserved as declarations/snapshots and are never inferred from dish names or descriptions.

The rolling workspace currently persists locally in `local-data/menu-planning/rolling-menu-weeks.json` for development. Production persistence and the eventual Menu Planning → Production projection should use the governed application persistence/contract boundary; the CPU workflow remains unchanged by this reset.

