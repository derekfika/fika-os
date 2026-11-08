# 2026-11-06 — Persist and propagate kitchen notes

Added optional canonical `kitchenNotes`, a version-checked notes-only Hub command, audit before/after evidence, and a durable CPU projection outbox with idempotent retry. Initial CPU handoff carries the field; quote snapshots continue to consume customer `notes` only.

Validation: `npm run typecheck`; `npx tsx --test tests/hospitality-kitchen-notes.test.ts tests/production-domain.test.ts` (9 passed, 6 emulator-gated tests skipped, including the new persistence/retry test). Deployment: none.
