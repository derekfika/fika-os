# 2026-11-13 — Cache CI npm downloads by lockfiles

Enabled setup-node npm caching for affected application jobs and the Hub emulator job, keyed by root and selected application lockfiles. This reuses npm's content-addressed download cache and leaves clean `npm ci` installs and all required gates in place.

Validation: exact-source CI pending; no checks or gates were removed. Deployment: none.
