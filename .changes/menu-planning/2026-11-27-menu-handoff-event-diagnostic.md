# 2026-11-27 — Read-only menu handoff event diagnostics

- Added an organisation-wide Menu Publish-authorised, publication-bound GET for one durable handoff event. It returns the stored payload, delivery attempts, timestamps and last error, while omitting transient worker lease identifiers and performing no replay or mutation.
- Validation: focused diagnostic tests and serial full Menu Planning tests pass (601 passed, 5 skipped); typecheck and production build pass. `fika validate` had one parallel fixture race in `rolling-menu.test.ts`; that test passed in the serial run.
- Deployment: not deployed.
