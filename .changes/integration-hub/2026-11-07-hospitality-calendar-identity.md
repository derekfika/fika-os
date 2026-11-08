# 2026-11-07 — Governed Hospitality Calendar identities

Hub resolves Hospitality Workspace mailboxes from its canonical site identity source. Calendar ID and delegated organiser overrides are separate, optional bindings. Before event reads or writes the Hub verifies the exact Calendar ID and writer/owner access; the OIDC delivery route accepts only the dedicated project Scheduler identity. Quote PDF checks include the organiser, CPUX and Logistics.

Validation: 15 focused Calendar mirror/Scheduler-auth tests passed; full Hub suite 1,018 passed, 120 emulator tests skipped, 1 failed because this worktree lacks sibling `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md`; Hub typecheck and production build passed. Menu Planning Calendar consumer test 3/3 and typecheck passed.
Deployment: none.
