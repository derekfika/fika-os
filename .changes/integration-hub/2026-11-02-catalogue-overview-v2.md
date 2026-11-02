# 2026-11-02 — Hospitality Catalogue overview component

Added an Overview component for the Hub Hospitality Catalogue with payload-derived item/service/location summaries, in-memory catalogue search, and actionable review findings. Counts remain unavailable when service settings are absent; the component does not claim that Hub settings prove customer-portal availability. Parent navigation wiring is a separate integration step.

Validation: `npx tsx --test tests/hospitality-catalogue-overview.test.ts` (5 passed); `npm run typecheck` passed. Browser rendering not verified because the parent page does not yet import this component.
Deployment: none.
