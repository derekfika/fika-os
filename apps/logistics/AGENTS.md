<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Logistics — scoped FIKA OS guide

Root [AGENTS.md](../../AGENTS.md) and the generated Next.js guidance above apply. Logistics owns movement planning, assignment, scheduling, driver execution, dispatch and collection; upstream production/menu/booking truth stays with its provider.

## Boundaries and contracts

- Consume canonical Fulfilment Requirements/Production Orders and preserve stable source, OPLOC/destination, unit and quantity identities. Do not invent movements for blank/no-service dates or treat display names as identity.
- Withdrawal/cancellation upstream must explicitly remove or supersede stale requirements/movements. Preserve receipt/idempotency/version evidence; partial downstream failure remains visible/retryable, not a false completed state. Advanced work requiring review must not disappear silently.
- Load capacity, scheduling and readiness use real quantities/windows and governed resource authority. Do not fabricate a midnight window for missing scheduling evidence or bypass readiness by supplying a convenient default.
- Preserve server-side AUTHMOD/resource/site checks, driver assignment boundaries and auditable state transitions. UI convenience cannot mutate upstream authority or grant broader access.
- Keep global/day feed and projection lineage consistent; day cursors follow the applicable global sequence. Do not copy cursor heads over missing history or silently replay excluded operational work. Missing, stale, corrupt and withdrawn projections remain distinct per detailed §5.
- Preserve optimistic/concurrent mutation protection, durable outbox delivery and idempotent retries across Hub/CPU contracts. Read detailed §§3–6/8 and the audit strategy before operational persistence changes; use bounded date/ID reads.

## UI and validation

- Root Style Guide applies to dispatch boards, timelines, load editors and driver actions. Semantic statuses must distinguish planned, pending, withdrawn and completed work; keep touch targets/focus/overflow usable.
- Read package scripts for focused authority, load-integrity, driver-execution, quantity/window, withdrawal and integration tests; use isolated test stores, then affected typecheck/build. Cross-app changes validate Hub/CPU producers as applicable.
- Include amendment/cancellation, stale versions, replay/no duplicates and persistence/restart cases. UI screenshots are not proof of operational reconciliation or dispatch correctness.

## Detailed references

- [Resource authority](docs/batch1-authority-drivers.md), [load integrity](docs/batch2-load-integrity.md), [driver execution](docs/batch3-driver-execution.md).
- [Logistics integrity](docs/batch4-logistics-integrity.md), [date/timeline handling](docs/batch5-date-timing-and-timeline.md).
- [Hub Logistics outbox](../../docs/deployment/integration-hub-logistics-outbox-scheduler.md), [shared contracts](../../packages/server-shared/src/external-production.ts), [detailed safety rules](../../docs/ai/agent-reference.md).

Dated batch/release records are context, not proof of current deployment, scheduler state or business UAT. Preserve the generated block above verbatim.
