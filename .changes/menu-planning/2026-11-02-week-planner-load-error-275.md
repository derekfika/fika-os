# 2026-11-02 — Menu Planning: Week Planner shows load errors and bounds IndexedDB (#275)

The Week Planner no longer shows "Loading Week Planner…" forever when the first load fails. A failed initial load now renders an
alert with the reason and a Retry button; HTTP 401/403 shows "Your session expired or you do not have access - sign in again from
the FIKA OS Hub" with a Hub link (existing `NEXT_PUBLIC_FIKA_HUB_URL`). The loading state is shown only while a request is in flight.
`planner-data.ts` keeps the HTTP status in a typed `MenuLoadError` (API contracts unchanged). The IndexedDB open in
`lib/menu-week-cache.ts` is bounded (3s timeout, `onblocked` handled, 30s skip after a failed open, late connections closed), and
cache persistence no longer blocks `setSnapshot`. Cache semantics on the happy path are unchanged.

Validation: `npx tsc --noEmit` clean; `npm test` in apps/menu-planning 471 pass / 0 fail / 1 skipped, including 6 new tests in
`tests/planner-load-error.test.ts`. Rendering of the error state is covered by source-contract assertions, not a browser run.
Deployment: none.
