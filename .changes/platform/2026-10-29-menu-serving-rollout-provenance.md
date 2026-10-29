# 2026-10-29 — Verify serving rollouts by their build reference

Menu staging uses a successful Firebase-generated rollout ID that differs from its build ID. The release CLI previously assumed they matched and failed preflight with 404. Serving verification now falls back only on 404 to complete scoped, paginated rollout discovery and requires one exact build-linked rollout. It checks backend/project aliases, READY/SUCCEEDED and stable 100% traffic; missing, ambiguous, unhealthy and unavailable evidence stays closed. Existing recovery uses the same pagination helper. Only the verified rollout resource name is memoized; every health check rereads authoritative state.

Validation: 15 focused serving/recovery checks and all 88 workflow tests passed. Exact-source CI is required before integration and recorded on the PR. No application source or build changed.

Deployment: none. This read-only inspection fix does not adopt a baseline, submit a rollout, change infrastructure or broaden production authority. Menu-specific baseline adoption remains pending separate owner approval under the current operator policy. No new recurring Firestore reads/writes or business audit events.
