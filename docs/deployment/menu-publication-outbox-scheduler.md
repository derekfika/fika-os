# Menu publication recovery — staging

Normal Menu publish/amend/day withdrawal/week withdrawal commits its authoritative
publication and durable events atomically, then returns HTTP success with handoff
`pending`. It does not call downstream consumers or depend on a Scheduler request.

`POST /api/internal/menu-publication-outbox` requires the existing
`x-fika-internal-token` matching `FIKA_INTERNAL_API_TOKEN`. Missing configuration,
missing credentials and mismatched credentials fail closed (503/401/403). Its
exact middleware exemption permits service authentication instead of an interactive
session; other internal paths retain normal admission. Body `{"limit":25}` is the
default; integer limits 1–25 are accepted and larger/invalid limits rejected.

The endpoint uses the existing global `replayMenuPublicationOutbox` primitive:
indexed bounded eligibility claims, aggregate predecessors, exclusive leases,
30-second retry backoff, ten-attempt dead letter and explicit manual recovery.
Delivery is recorded only after the existing Hub/CPU and Delivered-In consumers
succeed. Downstream stable identity/version guards retain replay safety.

Staging-only job: `fika-menu-publication-outbox-recovery`, project `fika-os-dev`,
location `europe-west4`, every minute in `Europe/London`, POST
`https://menu-planning-staging.fikacatering.com/api/internal/menu-publication-outbox`,
body `{"limit":25}`. Use the existing secret version `FIKA_INTERNAL_API_TOKEN@3`;
do not print or retain the token in evidence. No production configuration changes.

Expected recurring cost: up to 25 existing event claims/consumer attempts per
invocation, plus the existing bounded empty-queue/compatibility lookup. Terminal
history is excluded from the modern indexed eligibility query. No new business
audit writes or browser polling. Publication mutation read amplification is
unchanged. Current status is read on Portion Planner load/week-version change
and manual refresh: one deterministic publication read, existing publication-
scoped event-ID lookup, then direct event reads. Status is deliberately separate
from the week-version cache because worker delivery does not alter the menu week.

The publication detail API exposes `pending`, `delivered` or
`intervention-required` based on durable state. Missing historical obligations
remain pending, never falsely delivered. Targeted manual retry still requires an
Integration Administrator and uses existing explicit dead-letter reset semantics.

Actual provisioning, exact deployment and invocation evidence are recorded in
`docs/uat/autonomous-launch-uat-2026-10-07.md`; this document alone does not assert
that the scheduler is configured or live.
