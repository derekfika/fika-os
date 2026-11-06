# 2026-11-06 — Advance unchanged Menu publication lineage

When Menu Planning republishes a week, an unchanged day can receive a new immutable publication-day ID without a new content version. The Hub now advances that pointer on the existing active Production Order, recording an audit amendment and atomically refreshing its Fulfilment Requirement and Logistics invalidation. It retains order identity, quantities, status and allergen evidence, and ignores old publication replays or withdrawn work.

Validation: focused emulator regression passed (1/1); Hub emulator suite passed (45 passed, one skipped); Hub typecheck and build passed. Full `npm test` could not pass because the existing `address-workflow.test.ts` requires an absent external `fika-platform-specs` decision file; the repository gitlink has no `.gitmodules` mapping. Governed `fika validate` was interrupted during repeated workflow test worktree setup and remains incomplete.
Deployment: none.
