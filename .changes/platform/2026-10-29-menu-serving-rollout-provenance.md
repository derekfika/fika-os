# 2026-10-29 — Verify serving rollouts by their build reference

Menu staging uses a successful Firebase-generated rollout ID that differs from its build ID. The release CLI previously assumed they matched and failed preflight with 404. Serving verification now falls back only on 404 to complete scoped, paginated rollout discovery and requires one exact build-linked rollout. It checks backend/project aliases, READY/SUCCEEDED and stable 100% traffic; missing, ambiguous, unhealthy and unavailable evidence stays closed. Existing recovery uses the same pagination helper. Only the verified rollout resource name is memoized; every health check rereads authoritative state.

Validation: 34 focused serving/recovery/baseline/release checks and all 92 workflow tests passed. Exact-source CI is required before integration and recorded on the PR. No application source or build changed.

The owner explicitly approved extending the existing forward-adoption path to Menu staging for the verified `f4af81dd` baseline before deploying the spellcheck. The command now permits only Hub/Menu staging, requires an explicit instruction, two stable exact-source/backend/repository/traffic snapshots and healthy serving evidence, and follows distinct rollout/build IDs. Menu health must prove its exact SHA/app ID. Prior ledger and rollback evidence are preserved; every production and other app target remains closed. No historical release approval is asserted retroactively.

Deployment: none at this source commit. Lookup is read-only; actual baseline adoption is a separately authorised append-only ledger operation, and deployment remains governed. No infrastructure or production authority changes. No new recurring Firestore reads/writes or business audit events.
