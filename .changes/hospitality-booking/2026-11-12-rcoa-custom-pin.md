# 2026-11-12 — RCoA custom PIN length

Allow owner-selected 4–12 digit RCoA dashboard PINs while retaining salted scrypt verification, session signing, cookie scope, and login throttling. Add a Windows terminal setup command that masks and confirms the PIN and sends only its salted verifier to the selected environment's Secret Manager. Update the access guide and authentication coverage. Gallagher authentication is unchanged.

Validation: pending focused tests, Hospitality suite, typecheck, and production build.
Deployment: pending staging UAT and separately authorized production release.
