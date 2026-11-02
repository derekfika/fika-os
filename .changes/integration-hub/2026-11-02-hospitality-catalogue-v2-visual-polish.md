# 2026-11-02 — Hospitality Catalogue v2 visual polish

- Summary: Move the catalogue tab bar styling into `HospitalityCatalogue.css`, remove long tab descriptions, provide compact responsive tabs with selected/hover/focus states, and present one clear Overview title with a proper heading hierarchy. Refine title, body, card and helper spacing using the approved FIKA semantic tokens; primary actions use the standard 44px control token. Data, contracts and business behaviour are unchanged.

## Validation

Focused UX test passed (13/13); Hub typecheck and production build passed; scoped ESLint passed. Full Hub test suite: 948 passed, 116 skipped, 1 failed because the workspace lacks `fika-platform-specs/docs/business-decisions/addr-001-canonical-address.md` required by `tests/address-workflow.test.ts` (ENOENT).

Style Guide compliance: PASS.

## Deployment

Not deployed.
- Style Guide compliance: PASS.
- Deployment: Not deployed.
