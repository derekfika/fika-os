# 2026-11-04 — Fix Menu Planning hosted sign-in return target (#354)

Build the Week Planner sign-in return URL from the canonical public host for the active environment instead of the internal App Hosting request origin. Preserve the requested path and query while preventing an untrusted forwarded host from becoming the post-login redirect destination.

Validation: focused middleware regression 5/5 passed; Menu Planning typecheck passed; production build passed.
Deployment: not deployed; staging UAT remains required. Production was untouched.
