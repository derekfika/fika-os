# 2026-11-11 — Save incomplete Hospitality rotation drafts

Hub now accepts structurally valid Hospitality rotation drafts with an empty dish bank or unfinished weeks. Publication still validates the complete dish minimum before freezing provider evidence; revision, actor, audit, optimistic concurrency and idempotency behavior are unchanged.

Validation: Hospitality rotation contract tests pass; Hub typecheck and production build pass. Full Hub suite reports one failure because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent from this checkout. Deployment: pending governed release and authenticated UAT.
