# 2026-11-25 — Expose scoped product activation authority

The Hospitality Studio publication pilot response now includes the existing product activation decision, constrained by the Hub approval and staging booking/email flags. Studio uses this response to gate its separate activation action; no authority is inferred in the UI.

Validation: Integration Hub typecheck passed. The Hub publication emulator file ran with all six cases skipped by its explicit opt-in test guard; Hospitality Menu Studio typecheck, 109 unit tests, production build and two focused Firestore emulator suites passed. Staging deployment and authenticated activation verification remain with the owner. Deployment: none.
