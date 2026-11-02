# 2026-11-02 — Hospitality catalogue services and locations

Adds company-first editing for the eight existing booking services and a location view for inherited or custom service rules. Changes use the versioned Hub service-layout commands, preserve category order and site overrides, and retain Item inspector context without implying customer availability.

Validation: `npm --prefix apps/integration-hub exec -- tsx --test apps/integration-hub/tests/hospitality-catalogue-services.test.ts` (4 passed); `npm --prefix apps/integration-hub run typecheck` (passed). Deployment: none.
