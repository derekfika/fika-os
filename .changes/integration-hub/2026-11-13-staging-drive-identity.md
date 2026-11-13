# 2026-11-13 — Isolated staging Shared Drive service account and OAuth fallback

Added opt-in keyless staging Shared Drive service-account access and isolated user OAuth fallback with verified runtime/user/root ACL and production denial probes; DWD bindings and outside-root artifacts fail closed. Production/local identities and signed evidence remain unchanged. See docs/architecture/staging-drive-identity.md for architecture and administrator actions.

Validation: focused provider tests 14/14 passed; CPU focused tests 18/18, Hospitality focused tests 13/13, Hub group-quote tests 14 passed/1 emulator case skipped. Consumer typechecks passed. CPU, Hospitality and Hub production builds passed. Shared security tests are included in the CPU CI job. Exact-source CI recorded in the PR. Deployment: none; administrator identity/credential provisioning and genuine dual-signer staging UAT remain required before production promotion.
