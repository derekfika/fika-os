# 2026-11-07 — Remediate critical Hub Next.js advisories

Updated Integration Hub Next.js and its matching ESLint config to 16.4.5. The locked production dependency audit now reports zero critical advisories (15 total: 7 high, 8 moderate), down from one production critical. This removes the affected Next.js RCE advisories before any Beverage authorization endpoint is hosted.

Validation: Hub TypeScript check and production build passed. Hub tests: 1,014 passed, 120 conditional skips, 1 unrelated failure because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent from this checkout. Full dependency audit still finds 2 criticals in dev-only tooling (`proxy-addr` and `tar` beneath `firebase-tools`); neither is part of the production dependency set. Their developer/deploy-tool exposure is recorded for follow-up. No service or staging configuration was changed.
Deployment: none. Beverage endpoint activation remains disabled pending exact-source review and identity/transport proof.
