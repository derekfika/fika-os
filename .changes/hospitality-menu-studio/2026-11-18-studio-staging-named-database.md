# 2026-11-18 — Bind Studio staging to the isolated preview database

Studio staging uses its named Firestore database, exact custom origin and dedicated Hub View authority. The hosted preview blocks mutations and catalogue package reads. The local authoring path keeps the existing emulator and access behaviour.

Validation: Studio unit tests, isolated Firestore tests, typecheck and build.
Deployment: none. Staging provisioning and browser acceptance are pending.
