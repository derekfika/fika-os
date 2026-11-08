# 2026-11-06 — Clarify kitchen-only note visibility

Label the field “Kitchen-only notes” and show that the text is visible to the CPU kitchen only and excluded from customer quotes in both the booking detail editor and each service in the group amendment editor.

Validation: `npx tsx --test tests/quote-document.test.ts` (5 passed), `npm run typecheck`, and `npm run build` passed. `git diff --check` passed. Deployment: pending protected PR and production verification.
