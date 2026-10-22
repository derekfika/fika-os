# Integration Hub — scoped agent guide

Root [AGENTS.md](../../AGENTS.md) applies. Hub is the authority for canonical reference data, AUTHMOD access/OPLOC redirects, and its governed booking/production/fulfilment commands. It is not a second kitchen or dispatch state machine.

## Boundaries and contracts

- Trace routes → authorisation → domain services → transactions/outboxes. A session is not mutation authority; preserve capability/site checks and canonicalise historical OPLOC IDs before filtering. Never broaden missing scope or duplicate governed identity lists in consumers.
- Hospitality's server-side commercial authority resolves canonical Items, effective-dated Prices and sparse Offering exceptions. Do not recreate site-prefixed Items or a permanent Item × OPLOC matrix. Preserve governed routing review, merged Item-ID resolution, site-specific overrides/owners and historical quote evidence.
- Browser validation is not authority: booking rules, effective minimums, notice and material amendments remain enforced at the Hub transaction boundary. Preserve exact retries and legitimate historical/non-material amendments.
- Handoffs create/version canonical Production Orders and Fulfilment Requirements for CPU/Logistics. Cancellation, amendment, notification and downstream delivery use existing durable/idempotent evidence; pending delivery is not success. Do not enable email/schedulers as a side effect of a code fix.
- Contracts in [server-shared](../../packages/server-shared/src/index.ts) and [apps/shared](../shared/README.md) have multiple consumers. Validate every affected consumer, not Hub alone. Package publication is a governed mutation; GET reads must not publish/rebuild the catalogue.

## UI and validation

- Root Style Guide applies to Hub operational/admin UI; use existing structured editing, permissions and semantic status components.
- Read package scripts; use focused tests, then affected typecheck/build. For transaction, concurrency, authorisation, cancellation or outbox changes, exercise the actual API/persistence path on an isolated emulator, including rejected writes, stale versions and idempotent retries.
- Check provider/consumer contract tests for Hospitality, CPU, Logistics and other directly affected apps. Treat documented old failures as evidence to compare, not blanket waivers. Bound interactive reads; catalogue-wide admin operations are distinct from booking reads.

## Detailed references

- [AUTHMOD architecture](../../docs/architecture/authmod-architecture.md) and [session boundary](../../docs/architecture/authmod-phase-d-session-architecture.md).
- [Sparse catalogue](docs/hospitality-catalogue-sparse-model.md), [OAC catalogue engineering](../../docs/deployment/oac-catalogue-engineering-2026-10-20.md), [site matrix storage](../../docs/architecture/hospitality-site-matrix-drive.md).
- [Group quotes](docs/hospitality-group-quotes.md), [group amendments](../../docs/architecture/hospitality-group-amendment-lifecycle.md), [cancellation/email integration](../../docs/deployment/hospitality-cancellation-email-integration-2026-10-19.md).
- [Universal booking notice](../../docs/deployment/universal-booking-notice-2026-10-20.md), [Logistics outbox](../../docs/deployment/integration-hub-logistics-outbox-scheduler.md), [detailed safety rules](../../docs/ai/agent-reference.md).

These documents include dated rollout evidence; inspect current code/runtime before treating a reported deployment or limitation as current.
