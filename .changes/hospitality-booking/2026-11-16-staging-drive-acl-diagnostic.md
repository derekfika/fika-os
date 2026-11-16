# 2026-11-16 — Scoped staging Drive ACL diagnostic

Added a staging-only, read-only RCoA Drive ACL diagnostic. It requires the existing explicit Hospitality Admin grant, verifies the staging runtime and dedicated identity, proves production sentinel denial before returning bounded permission IDs and inheritance metadata, and never returns tokens, file contents or email addresses.

Validation: all 481 Hospitality tests passed; route-access and Drive-guard suites passed (12 tests); Hospitality typecheck and production build passed. ESLint could not run because this app checkout has no ESLint config.
Deployment: exact-source PR and staging release pending.
