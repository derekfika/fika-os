# 2026-11-20 — Hospitality Rotations typography (#219)

- Changed the Rotations surface and native controls to use the shared `--fika-font-body` token, which resolves to the app's loaded `FIKA Gilroy` face.
- Added a style contract test covering the token, font-face and control inheritance.
- Validation: focused style contract test passed; Menu Planning unit suite passed (583 passed, 4 gated skips); typecheck and production build passed. Build reports only the existing Next.js middleware convention deprecation.
- Deployment: not deployed. Staging browser acceptance and font network/computed-style inspection remain pending because no authenticated in-app browser tab was available; no screenshot or hosted UAT is claimed.
