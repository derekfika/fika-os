# 2026-11-07 — Enforce local Beverage actions and monthly special scope

Fail closed on missing, blank or invalid fixture permissions and keep storage in explicit local emulator mode. Restrict contributor edits to editable draft fields. Require access to every stored and proposed target OPLOC on monthly special changes and verify current scope again on retries. Filter the bounded local list and make unassigned drafts private to their creator. Document the canonical Hub registration and decision contract required for functional staging.

Validation: 20 Beverage tests, five isolated Firestore emulator tests, typecheck, Webpack build and both dependency audits with zero vulnerabilities. Actual route tests cover action separation, scope changes, denied writes and receipt replay. The emulator ran on a separate loopback port.

Deployment: none.
