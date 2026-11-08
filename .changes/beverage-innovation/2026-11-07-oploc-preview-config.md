# 2026-11-07 — Enable exact-site Beverage OPLOC preview

Enable the authenticated Beverage preview GET for the 19 exact active canonical staging OPLOC IDs verified from package v4. The scope is tied to the recorded canonical inventory hash and fails closed if omitted or invalid.

Validation: verified the exact 19-ID scope count and inventory hash against the current staging package, and passed `git diff --check` and the governed changelog check. Exact-source CI remains required before merge.
Deployment: none.
