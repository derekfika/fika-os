# 2026-11-11 — Save incomplete Hospitality rotation drafts

Hub now accepts structurally valid Hospitality rotation drafts with an empty dish bank or unfinished weeks. Publication still validates the complete dish minimum before freezing provider evidence; revision, actor, audit, optimistic concurrency and idempotency behavior are unchanged. AUTHMOD now recognises Hospitality Rotations as an organisation-scoped, person-only authority and exposes separate View and Manage grants on account detail; this control does not grant Publish.

Validation: Hospitality rotation contract tests and AUTHMOD authority tests pass; Hub typecheck and production build pass. Full Hub suite reports one failure because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent from this checkout. Deployment: pending governed release and authenticated UAT.
