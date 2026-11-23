# 2026-11-23 — Ad Hoc CPU scope and allergen status

Added the CPU Production Scope selector, independent of request category, and routed selected scope through Ad Hoc handoff. The event form preview follows the selected CPU section. Allergen status now reflects current CPU release lineage and required signatures; the PDF link appears only for verified current evidence.

Validation: Ad Hoc typecheck, full unit suite (42 passing, 11 skipped), emulator suite (11 passing), and production build passed. Hub scope/handoff emulator cases passed. UI Style Guide compliance: PASS. Staging UI UAT not run; the deployed Ad Hoc staging build predates PR #658.
Deployment: none.
