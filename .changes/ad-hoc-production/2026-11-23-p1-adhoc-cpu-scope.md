# 2026-11-23 — Ad Hoc CPU scope and allergen status

Added the CPU Production Scope selector, independent of request category, and routed selected scope through Ad Hoc handoff. The event form preview follows the selected CPU section. Allergen status now reflects current CPU release lineage and required signatures; the PDF link appears only for verified current evidence.

Validation: Ad Hoc typecheck, full unit suite (42 passing, 11 skipped), emulator suite (11 passing), and production build passed. Hub scope/handoff emulator cases passed. UI Style Guide compliance: PASS. The custom-domain app title loaded, but authenticated round-trip and end-to-end browser UAT are BLOCKED because desktop capture returned a mismatched app surface; no staging orders were created.
Deployment: Ad Hoc staging build `build-2026-11-23-001`, source `a2e123b4af1629828e4046004b74ae423161d41d`, 100% traffic, release `1c54129e-8670-47c3-8014-1907e49c1067`. No production deployment.
