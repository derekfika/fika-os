# 2026-10-30 — Logistics tablet van lane regression

Add mounted Playwright coverage at actual 820px and 1024px viewports for canonical per-van lanes, multiple and overlapping runs, keyboard selection, empty/untimed vehicles, essential controls and layout clipping. No application behavior changed. At 820px the new check reproduces 21px document-level horizontal overflow; a separate UI fix needs owner approval.

Validation: targeted Playwright: 7 passed, including 1024px; 820px fails on the reproduced document overflow. Logistics typecheck and changelog check passed.
Deployment: none.
