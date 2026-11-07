# 2026-11-07 — App Hosting build config typecheck

- Date: 2026-11-07
- Task: Hub production build recovery
- Summary: Removed a test's type-level import of `next.config.ts`; Firebase App Hosting rewrites that file during its build, so the default export was absent when Next.js typechecked the test. The test now asserts the source config without importing the adapter-mutated module.
- Validation: Focused `apphosting-build-config.test.ts` passed (4/4); Hub typecheck passed; production build passed. Exact-source CI is pending.
- Deployment: Not deployed; the failed `c3b6e86` rollout remains abandoned and production traffic stays on `0fa57a5`.
