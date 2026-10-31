# 2026-10-29 — Protected Rotations picker resources

Added a Manage-authorised Hub resource read for current Dish Library and Hospitality catalogue choices. Dish Library reads use one Firestore manifest document plus integrity-checked immutable package data; responses expose picker metadata only and GET never rebuilds packages.

Validation: focused Rotations provider/resource tests (11 passed, 1 isolated-emulator test skipped), Hub typecheck and build passed. Full Hub suite: 832 passed, 103 skipped, 1 unrelated failure because `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` is absent in the workspace. Exact-source CI passed.
Deployment: verified on Hub staging build `build-2026-10-29-004`, source `773d4229481de4e388782b389521968b5909e94d`.
