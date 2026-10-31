# 2026-10-31 — AUTHMOD: grant Food Data access from Special Authority

Food Data access is the explicit authority `integration-hub / food-data.catalogue / View`, but the account screen only listed Menu Publish and AUTHMOD Admin, so the grant could not be created from the UI. Adds a "Food Data (Kafoodle)" row to Special Authority (people only, organisation-wide, View) using the existing audited grant/revoke command. No change to authorisation logic, grants already held, or any other app.

Validation: new `tests/food-data-grant-ui.test.ts`, `tests/food-data.test.ts` and `tests/authmod-admin.test.ts` pass (36); Hub typecheck clean. The existing ESLint setState-in-effect error at AccountDetail.tsx:46 predates this change.
Deployment: pending (Hub staging).
