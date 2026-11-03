# 2026-11-03 — Guard CPUX Calendar writes to production

CPU Calendar writes now require exact production mode and project identity, explicit enablement, and a configured Calendar ID. Staging and production manifests keep live writes and historical backfill off by default. Backfill now previews bounded counts read-only and requires a separate production-only enable flag to execute. Eligibility is based on canonical Production Orders with Sandwiches lines; local CPU planning drafts remain eligible because the upstream hand-off already created the canonical order. The emitted event shape is checked against the legacy CPUX scanner so it is ignored instead of imported as duplicate production demand.

Validation: publisher and consumer-invalidation regressions passed; CPU typecheck passed. Full app build and merged-configuration validation remain pending final integration. Deployment: none; production Calendar writes remain disabled pending Calendar ID and least-privilege ACL verification.
