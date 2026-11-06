# 2026-11-06 — Company-wide Hospitality Admin authority

Derive company-wide booking amendment access from the current authenticated active Superuser identity or an explicit organisation-scoped Hospitality Admin grant. Recheck the identity, app admission, active booking OPLOC and direct grant at the Hub boundary; keep prior site-scoped grants from widening. AUTHMOD now presents Superuser access as computed and the direct grant without an OPLOC picker.

Validation: focused AUTHMOD permission tests passed (7/7); Firestore booking cutoff/amendment emulator passed (1/1), including standalone and grouped late amendments for an active Superuser without Legend linkage; Hub and Hospitality typechecks passed; both production builds passed. Hospitality full tests passed (434/434). Hub full suite had 978 passes and 116 skips, with one unrelated failure because this worktree lacks `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md`; changelog check passed.
Deployment: not deployed. Source is ready for direct production deployment after protected PR merge and exact-source CI.
