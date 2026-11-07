# 2026-11-07 — Add a dedicated Beverage reference read boundary

Add a disabled-by-default Hub reference surface with exact Beverage server identity and a direct Beverage View entitlement for the current person and requested OPLOCs. Return approved site labels and support a separately gated, pinned, integrity-checked Food Data ingredient snapshot through bounded read-only operations.

Add a staging operator command to capture the verified current OPLOC inventory for a later audited grant. Keep the hosted OPLOC endpoint scoped to already entitled sites.

Validation: 1,029 Hub tests and 46 isolated Firestore emulator tests passed, with 121 conditional unit skips and one emulator skip. All 18 focused tests passed, covering direct-grant enforcement, current-only inventory verification and Food Data closure in OPLOC-only configuration. The command refused local runtime before opening a read. Hub typecheck and build passed. Hub dependency findings remain an activation gate.

Deployment: None. No activation settings, live grants or staging writes.
