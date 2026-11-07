# 2026-11-07 — Add a dedicated Beverage reference read boundary

Add a disabled-by-default Hub reference surface with exact Beverage server identity and a direct Beverage View entitlement for the current person and requested OPLOCs. Return approved site labels and support a separately gated, pinned, integrity-checked Food Data ingredient snapshot through bounded read-only operations.

Validation: 1,026 Hub tests and 46 isolated Firestore emulator tests passed, with 121 conditional unit skips and one emulator skip. All 15 focused AUTHMOD and reference tests passed. They cover direct-grant enforcement, generic site assignment denial and Food Data closure in OPLOC-only configuration. Hub typecheck and build passed. Hub dependency findings remain an activation gate.

Deployment: None. No activation settings, live grants or staging writes.
