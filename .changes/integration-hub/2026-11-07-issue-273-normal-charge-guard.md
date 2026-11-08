# 2026-11-07 — Enforce overtime-only Hospitality labour changes

The authoritative Hub rejects every new or changed labour charge unless it uses an approved role's base rate and the locked 1.5× multiplier. Unchanged historical Normal and legacy custom/configured snapshots remain preserved, while quote revisions retain their original snapshots.

Validation: Focused charge/quote/workflow/group tests 46 passed, 16 emulator tests skipped (including exact-rate custom/configured historical Normal snapshots); typecheck and production build passed. Before the final provenance regression was added, the full Hub suite had 990 passed, 120 skipped, and one unrelated baseline failure because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent. Group emulator UAT was skipped; no staging writes.
Deployment: none; staging booking and quote verification remain outstanding.
