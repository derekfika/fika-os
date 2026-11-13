# 2026-11-13 — Run required CPU checks in parallel lanes

Split affected CPU validation into required unit/shared-contract, real Firestore route, and exact-source typecheck/build jobs. Java and Firebase CLI setup moves with the CPU emulator test, while the Ad-Hoc emulator setup remains in its existing application lane. The merge gate requires every CPU lane, and other application paths remain unchanged.

Validation: CPU local full, unit and Firestore suites passed; all 27 shared contract cases, routing guard, typecheck and production build passed. Exact-source GitHub Actions validation remains required before integration. Deployment: none.
