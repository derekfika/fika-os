# 2026-10-31 — Governed bulk category changes

Adds an opt-in Category field to the Integration Hub bulk catalogue editor. Category-only edits retain optimistic item versions, per-item atomic audit evidence and idempotent receipts; item names, routing, pricing, minimums, site allowlists, sparse offering exceptions and history remain unchanged. Review summarizes selected category transitions and checks the stored #175 service layout per available site. Unmapped targets are held, assessed visibility changes require explicit confirmation, and the audit records the confirmation plus bounded before/after service effects and layout versions. The preview is not a claim about current booking portal runtime visibility; no service layout is modified.

Validation: focused bulk and route-contract tests, isolated Firestore emulator bulk suite, Hub typecheck, targeted ESLint and Hub build. Full Hub lint reports pre-existing errors in unrelated files; see task report.
Deployment: none; no catalogue data was edited and no staging or production deployment occurred.
