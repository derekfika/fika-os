# 2026-11-16 — RCoA Hot Fork Buffet full-screen selector

Replaced the RCoA buffet dialog presentation with a responsive full-viewport menu-builder step and persistent selection/validation summary. The same screen is used by RCoA standalone and All Day/group amendment editors; other Hospitality sites retain their existing selector. Selection DTOs, server-authoritative validation, saved quote and explicit CPU handoff boundaries are unchanged. Production customer ordering remains gated off.

Validation: Hospitality tests (477 passed), typecheck, and production build passed. Style Guide compliance: PASS; the new screen uses shared FIKA semantic tokens and accessible native controls. Authenticated staging PDF/CPU UAT remains blocked by the staging Drive ACL guard (`The staging root has unexpected direct or inherited access`) and is tracked separately.
Deployment: none.
