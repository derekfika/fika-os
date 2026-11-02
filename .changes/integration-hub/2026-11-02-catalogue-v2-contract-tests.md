# 2026-11-02 — Update catalogue UI source contracts

Adjusted the existing Hub UI tests to recognize the new Services/Locations mount and to distinguish URL query cleanup from destructive catalogue deletion.

Validation: `npx tsx --test tests/hospitality-catalogue-bulk.test.ts tests/hospitality-service-layout-editor.test.ts` (18 passed).
Deployment: none.
