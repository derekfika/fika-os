# 2026-11-01 — Show run stops beneath each run in the van timeline row (#120)

Each run's visiting sequence (CPU, customer visits, CPU) again renders directly beneath that run's own bar inside its Van 1 / Van 2 row, instead of only in the separate "Selected run details" block added with the van lanes. Runs sharing a van keep their bar positions and ordering; overlapping runs sit in separate bands, each with its own stops beneath it; untimed drafts show their stops under their "Times to set" button. The selected-run block no longer repeats the sequence, and the inspector, selection, collapse toggle and overlap warnings are unchanged. Presentation only: no domain data, routing or command changes.

Validation: Logistics typecheck; `npm test` 707/707; Playwright (journey-planner-v3, v2, journey-redesign, stop-visits projects) with the old-layout specs updated and a new 820/1024/1280/1536px regression asserting stops sit under their run in the van row, in order, once, with no page overflow. Two legacy-UI specs (journey-redesign mock-day click, stop-visits classic selector) fail independent of this change and were not baselined.
Deployment: none.
