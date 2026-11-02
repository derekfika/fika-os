# 2026-11-02 — Menu Planning: bound Week Planner request waits (#275)

The Week Planner now bounds rolling-menu network requests to 20 seconds and aborts a stalled request. A timeout flows through the existing initial-load error state, where users can retry; successful requests and existing HTTP authentication errors keep their current handling. The timeout covers fetching and reading the response body. No API, cache identity, publication, menu data or audit semantics changed.

Validation: focused planner-load-error tests (8 passed); Menu Planning test suite (481 passed, 2 skipped); Menu Planning typecheck; production build. Deployment: none.
