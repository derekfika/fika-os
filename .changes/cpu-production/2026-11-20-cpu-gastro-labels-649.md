# 2026-11-20 — CPU Gastro Label Printing (#649)

Add a separate Delivered-In action for manual Planglow DIS003 Gastro Labels. It reads the selected service date from the current CPU projection, keeps label counts local, previews 2 × 4 Trial C sheets, and opens the normal browser print dialog without changing operational quantities.

Validation: focused label tests, CPU typecheck, CPU build, and Chromium PDF geometry check passed. Full CPU regression result pending.
Deployment: not deployed; production release remains gated on merged exact-source CI and governed CPU release verification.
