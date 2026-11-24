# 2026-11-24 — Supplementary menu production contract

Extended the shared Menu Planning to Hub production contract with optional menu identity, service label, service time and kitchen notes. Hub retains these fields on canonical Production Orders and applies the service time to the production required-by context; explicit empty notes clear stale values on amendment.

Validation: PR and post-merge GitHub checks passed; focused Hub contract/domain tests (10 passed, 16 emulator cases skipped), typecheck and build. Staging: deployed and verified at main SHA `5e436da8d5666ad2f9794b1655be6352cec3d62d`; governed rollout reached 100% with smoke probe passing. The Hub authenticated custom-domain landing page loaded. Feature data UAT remains pending a designated fictional staging OPLOC. Production: not deployed.
