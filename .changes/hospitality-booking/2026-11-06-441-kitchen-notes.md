# 2026-11-06 — Separate internal kitchen notes

Added escaped multiline kitchen notes and a notes-only, version-checked save and retry control in standalone and per-service group amendment/detail views. Customer notes remain customer-facing and the existing commercial quote snapshot remains the source for quote rendering.

Validation: `npm run typecheck`; `npx tsx --test tests/quote-document.test.ts` (all passed). Style Guide compliance: PASS. Deployment: none.
