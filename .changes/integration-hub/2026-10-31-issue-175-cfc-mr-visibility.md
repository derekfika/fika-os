# 2026-10-31 — CFC and Munich RE booking visibility enforcement

Hub public site resolution and booking acceptance now require the unique confirmed stable-key provider-location mapping for CFC and Munich RE. New bookings validate current service visibility against canonical active Item categories; changed amendment demand uses canonical/provider mapping authority while preserving non-demand historical snapshots.

Validation: Hub focused tests (16 passed; 2 emulator-gated tests skipped in the standard run), typecheck, and production build passed. A focused CFC rejection transaction test also passed against an isolated Firestore emulator and confirmed no booking write.
Deployment: none.