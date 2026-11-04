# 2026-11-04 — Expose trusted global CPU access scope

CPU access admission now returns the existing AUTHMOD `scope.all` decision as an explicit `allOplocs` boolean. CPU consumers can distinguish global kitchen operators from site-scoped access without guessing from roles or a current OPLOC list. Existing session, application admission, package validation and site filtering remain authoritative. This additive response field introduces no extra reads, business/audit writes, migrations or background work.

Validation: 12 focused route/admission/scope tests passed; Hub typecheck and production build passed. Governed scope/changelog checks and validation plan passed; full application/tooling/emulator suites remain for exact-source CI. Consumer parser and one-off route integration remain in the coordinated recovery task.
Deployment: none; integration is held for the recovery coordinator.
