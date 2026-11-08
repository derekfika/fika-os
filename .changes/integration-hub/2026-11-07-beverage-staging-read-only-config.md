# 2026-11-07 — Configure staging Beverage reference reads

Enable the default-off, read-only Beverage OPLOC endpoint in Hub staging with the dedicated Beverage preview identity. Keep the Food Data routes closed and leave Hub sign-in policy unchanged.

Validation: verified the staging runtime identity and subject from Firebase App Hosting/IAM, matched the exact 19-ID inventory hash, and passed `git diff --check` and the governed changelog check. Exact-source CI remains required before merge.
Deployment: none.
