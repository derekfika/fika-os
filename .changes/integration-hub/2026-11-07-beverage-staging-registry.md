# 2026-11-07 — Prepare the hidden Beverage staging registry

Add a staging-only operator command that plans or creates the fixed hidden Beverage View registry entry. Verify an existing ADC operator and their direct AUTHMOD administration authority. Commit the registry, audit and applications head together, then verify the canonical reference package. Leave person-specific admission and grants to their separate commands.

Validation: 1,030 Hub tests and 47 loopback Firestore tests passed, with 122 conditional unit skips and one emulator skip. Focused tests covered Google/Firebase identity proof, no cross-app authority change, atomic creation, idempotent replay and current reference verification. Typecheck and production build passed.

Deployment: None. The provisioning command was not run against staging.
