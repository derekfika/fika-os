# 2026-11-11 — Add the scoped RCoA dashboard booking projection

Adds a separate read-only Hub bridge that requires one confirmed RCoA provider-location mapping, queries only canonical RCoA bookings, verifies the exact OPLOC, pages up to 8,000 complete rows, and returns a customer-safe allow-list. The projection excludes identity, commercial, notes, audit, allergen, and attachment data. No booking persistence or lifecycle behavior changes.

Validation: Integration Hub typecheck passed; the full suite passed (1,041 passed, 122 skipped); production build passed; targeted ESLint passed for the new service, route, and tests; repository `fika validate` passed all 7 affected-app commands. Full-app ESLint still reports existing project-wide errors (157 errors, 91 warnings) outside this task. The 122 emulator tests were skipped by the app test script; browser and staging verification remain pending.
Deployment: none. Staging bridge credentials were not provisioned.
