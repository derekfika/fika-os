# 2026-11-26 — Six-week Studio booking and CPU handoff coverage

The isolated Hub acceptance suite follows a signed Finger Food product menu through all six rotation weeks. Each booking sees its week's six dishes and rejects a dish from another week. The test checks the saved quantities and publication hash, the frozen quote and kitchen specification, and the single Production Order and linked Fulfilment Requirement after a repeated Send to CPU.

Validation: all 71 Hub emulator tests passed, including 11 Studio publication and handoff cases. Hub TypeScript checks passed.

Deployment: none. This change adds test coverage only.
