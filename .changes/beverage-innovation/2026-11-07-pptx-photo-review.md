# 2026-11-07 — Review PPTX photo provenance locally

Extend the local PPTX recipe adapter to show supported embedded image layers with slide/object positions and SHA-256 provenance for human review. Keep image bytes in the request/page memory only; drafts retain compact references, not photographs. Require explicit source classification before local draft creation. No source handoff files were added to the repository.

Validation: Beverage unit tests (33), Firestore emulator tests (6), typecheck, production build, and `npm audit --omit=dev` all passed. Build/test outputs remain isolated in the task worktree.
Deployment: none. No source recipe or photo data was imported into staging.
