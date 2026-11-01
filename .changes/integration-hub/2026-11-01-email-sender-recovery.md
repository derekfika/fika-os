# 2026-11-01 Hospitality sender identity recovery

Recover PR #30's code-only site sender rules on current main: canonical OPLOCs bind fixed From/Reply-To identities; delegated mailboxes require per-site authorization and verified Send As; new production sites require exact UTC launch cutoffs so older queued rows stay inert. Existing staging outbound isolation, grouped notifications, RCoA exclusions and uncertain-send barriers are preserved. No mailbox configuration or site activation changes.

Validation: 41 focused email/auth/isolation tests and all 44 isolated Hub emulator cases passed. Governed validation passed 106 workflow tests, 928 Hub tests (116 skipped), typecheck and build after hydrating the exact CI-pinned platform-specification documents. Independent source review found no blocking issue. Exact-source CI pending.
Deployment: none. No messages, configuration writes, migrations or production changes.
