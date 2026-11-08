# 2026-11-08 — Restore Sherice's staging Beverage sign-in

Allow Sherice's verified Gmail address as an exact staging-only AUTHMOD identity exception, preserve the FIKA domain rule for other users, remove the staging Google hosted-domain prefill, and proxy Firebase's redirect helper through the staging Hub domain for Safari storage-partitioned browsers. The Firebase Google OAuth client also needs `https://staging-os.fikacatering.com/__/auth/handler` added to its authorised redirect URIs before rollout.

Validation: focused AUTHMOD session tests (14/14), Hub typecheck, staging-configured Hub build, full Hub suite (1,153 tests: 1,031 passed, 122 skipped, 0 failed), and `fika validate` passed. Emulator-dependent tests were skipped by the suite's default mode.
Deployment: not deployed; Google Cloud OAuth console update awaits account re-verification in the in-app browser.
