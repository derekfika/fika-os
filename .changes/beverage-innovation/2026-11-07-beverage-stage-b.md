# 2026-11-07 — Beverage Stage B local workflows

Adds isolated Beverage Firestore persistence, strict schemas, atomic versioned commands and audit events, recipe cost/GP calculations, immutable version approval, monthly special date/site workflows, and pasted-recipe parsing, preview and deliberate local draft creation. The Stage A `/mock` layout and image assets remain unchanged; imagery remains provisional. Final lifecycle approval is blocked until an actual drink photo is reviewed and referenced. Adds Stage B governance and local emulator instructions. No other app or shared provider was changed.

Complexity: High. Recommended model: Sol. Reason: persistence, authorization boundaries, audit/version semantics and multiple core workflows require coordinated correctness.

Style Guide compliance: PASS. The new screens reuse Beverage's approved Stage A FIKA palette and type pairing, maintain light operational surfaces, and include labeled controls, status text and visible keyboard focus.

Validation: `npm run typecheck` passed; `npm test` passed (10 tests); `npm run test:emulator` passed (2 integration tests for persistence, idempotency, conflicts, audit, recipe approval/import and monthly site assignment); `npm run build` passed; `npm audit` and `npm audit --omit=dev` reported 0 vulnerabilities. Local browser check passed for concept persistence, special navigation and recipe import preview. The server was restricted to local fixture auth and Firestore emulator project `demo-fika-os` on loopback port 8294.

Deployment: none. Stage C/D integrations and deployment remain blocked by stabilisation and separate owner authorization; #423 and #429 remain open and are not asserted complete.
