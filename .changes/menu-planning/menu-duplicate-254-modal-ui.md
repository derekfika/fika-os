# 2026-11-02 — Duplicate Planning modal visual and accessibility repair

Set the Duplicate Planning dialog to the shared large-modal width, keep scrolling inside its content, clarify the bounded destination-week selection, and improve control sizing and keyboard focus visibility. The duplicate preview, cancellation safety, and published-week protections remain in place.

Validation: `npm exec -- tsx --test tests/duplicate-planning-modal-ui.test.ts` passed; `npm run typecheck` passed. No build or deployment run.
Deployment: none.
