# 2026-10-29 — Deploy Rotations provider foundation to staging

Deployed exact merged source `6fe91d6c` through the governed CLI. Hub staging build `build-2026-10-29-003` is READY/SUCCEEDED at 100%; rollback provenance retained. Live root 200 and Rotations access API 401 confirm route presence and the anonymous gate. Derek's earlier approved staging grants remain effective. Connected planner UAT remains separate.

Validation: exact-source merge-gate, Hub application and emulator CI passed. Serving source/traffic and non-mutating HTTP smoke verified. No production or operational data change. Full release evidence: `docs/deployment/2026-10-29-rotations-foundation-staging.md`.

Deployment: verified Hub staging only, source `6fe91d6c`, build `build-2026-10-29-003`.
