# 2026-10-28 — Activate Menu publication delivery

Following explicit owner approval, enabled the existing production Menu publication recovery worker and aligned its attempt deadline from 60s to the endpoint/runtime's 300s. The 50 outstanding events across 26 October and 2 November were delivered through the normal idempotent path. November's 23 canonical orders match CPU, and all 23 allocated date/site projections are current in Delivered-In. Other schedulers, credentials and app source remain unchanged.

Validation: bounded live verification of event status, 23 order/source identities, 242 line quantities/units/allergen snapshots, 6,613 portions, CPU projections and Delivered-In lineage; zero comparison errors. Subsequent recurring Scheduler runs returned HTTP 200. Diagnostic syntax check passed. No application deployment/typecheck/build was needed; Menu remains #112 source `39f642d1`, build `build-2026-10-28-001`. Governed validation is recorded in task completion evidence. Existing minute-based worker costs now apply; no new audit/read path was introduced.

Deployment: no application deployment; owner-authorised production Menu Scheduler activation and deadline alignment verified live.

Governed validation: all 80 workflow tests passed; whitespace check passed. Incident #111 closed after actual publication and downstream verification.
