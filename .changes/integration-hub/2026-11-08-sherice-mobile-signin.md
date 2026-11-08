# 2026-11-08 — Restore Sherice's staging Beverage sign-in

Allow Sherice's verified Gmail address as an exact staging-only AUTHMOD identity exception, preserve the FIKA domain rule for other users, remove the staging Google hosted-domain prefill, and proxy Firebase's redirect helper through the staging Hub domain for Safari storage-partitioned browsers. Added and verified `https://staging-os.fikacatering.com/__/auth/handler` on the Firebase Google OAuth client, retaining Firebase's existing callback.

Validation: focused AUTHMOD session tests (14/14), Hub typecheck, staging-configured Hub build, full Hub suite (1,153 tests: 1,031 passed, 122 skipped, 0 failed), and `fika validate` passed. Emulator-dependent tests were skipped by the suite's default mode.
Deployment: verified on staging SHA `45bc309e27d6ca1948f4afbba0d5377e0ba18a28`, rollout `build-2026-11-08-002`, 100% traffic; smoke check passed (HTTP 200). The staging OAuth callback was read back in Google Cloud Console.
