# 2026-10-31 — Kafoodle Food Data: product/supplier and recipe libraries (staging, read-only)

Adds an isolated `/food-data` section to the Integration Hub that serves the private Kafoodle export (14,007 products,
1,560 recipe rows) from Cloud Storage through two authenticated same-origin endpoints, verifies it against the
manifest SHA-256 hashes, and caches each dataset once per version in a scoped IndexedDB. Access needs an explicit AUTHMOD
`integration-hub / food-data.catalogue / View` grant; the feature is enabled in staging and local only. No Firestore
catalogue reads, no writes, and no existing app, collection or workflow is changed. Design: `apps/integration-hub/docs/food-data-library.md`.

Validation: 32 focused tests (`tests/food-data.test.ts`), Hub typecheck, ESLint on the new files, production build, and a local
end-to-end run against the real export (cold load = manifest + 2 bundles, warm load = manifest only, search/detail = 0 requests).
Deployment: none. Staging deployment and the bucket read permission for the Hub runtime identity are pending owner approval.
