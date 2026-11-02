# 2026-11-02 — Hospitality Catalogue v2 management shell

Added a company-first Overview, Items, Services and Locations navigation model with URL-backed context, a clearer Item summary, and grouped bulk-edit controls. The UI continues to use the existing canonical catalogue and service-layout commands; it does not add service CRUD or per-Item service membership. Customer availability language distinguishes stored Hub configuration from verified portal behavior.

Validation: focused Hub catalogue/service tests (39 passed), `npm run typecheck`, scoped ESLint, and `npm run build` passed. The full local Hub suite reported 948 passed, 116 skipped and one failure because the checkout lacks the pinned `fika-platform-specs` ADDR-001 document; exact-source CI supplies that dependency.
Deployment: none.
