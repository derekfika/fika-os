# 2026-11-05 Hub Menu order contract (#334)

Date: 2026-11-05
Task: Hub Menu order contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app production order materialisation and fulfilment boundary.
- Hub preserves versioned canonical Menu slot identity and authored labels in canonical Production Order lines, enabling downstream CPU and Logistics ordering parity.
- Validation: focused Hub materialisation and fulfilment regressions (9 passed, 3 emulator-only skipped) and Hub typecheck passed. Full Hub suite: 960 passed, 116 skipped, one missing platform-specs submodule fixture failure. Exact-source CI pending.
- Deployment: not deployed.
