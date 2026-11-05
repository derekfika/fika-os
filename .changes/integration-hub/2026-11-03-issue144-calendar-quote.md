# 2026-11-03 — Read-only current CPU quote resolver (#144)

Adds a read-only quote context for CPUX Calendar publishing and an authenticated current-PDF lookup. Known-ID reads follow the existing canonical handoff/supersession chain (maximum ten orders), then require the exact current, non-stale, saved quote revision at the booking's commercial version. Grouped quote references retain their existing shared file identity; no historical PDF or metadata is rewritten. Interactive access requires CPU AUTHMOD admission and the governed OPLOC after alias resolution; service access requires the existing configured internal token.

Cost/audit: no new recurring job, collection scan or business audit write. The ordinary context reads one order and its booking enrichment plus the booking authority (three document reads), with at most ten order lookups on a supersession chain, plus existing AUTHMOD reads for interactive access. No changes to booking, production or downstream contracts/persistence.

Validation: 10 focused quote-context/internal-auth tests, Hub typecheck and production build using the demo project and closed loopback emulator endpoint. Tests cover immutable history, grouped references, stale/missing artifacts, bounded/cyclic/cross-booking lineage, anonymous denial, site entitlement and unavailable AUTHMOD. No live Google/production-data UAT or full suite run.

Deployment: none; no data migration, Drive write, Calendar write or backfill executed.
