# 2026-10-30 — Preserved recovery of one stacked workspace lease

Add a separate administrator-only preview/execution command for one exact active lease
blocked by stacked committed scope. Require exact owner/IDs, pushed HEAD/open PR,
retired ancestry/preservation evidence, reviewed full integration scope, registry lock
and repeatable preview hash. An atomic audited revocation retains checkout, ignored
data, branches, PR and full-history recovery evidence. Normal scope checks stay intact.
Document the separate owner decision and fresh Claude integration lease for #128;
this implementation does not execute recovery against that lease.

Validation: six focused recovery regressions passed; canonical governed validation
passed all 94 workflow tests; all 19 dashboard tests passed. Two final focused cases
also passed after tightening predecessor-bundle verification. Workspace scope, affected,
changelog and staged diff checks passed. Exact-source CI is recorded on the separate PR.
No application boundary changed; no application builds/typechecks required.
Deployment: none. No production, data migration or operational mutation.
