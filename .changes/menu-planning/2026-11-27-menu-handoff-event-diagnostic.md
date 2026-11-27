# 2026-11-27 — Read-only menu handoff event diagnostics

- Added an organisation-wide Menu Publish-authorised, publication-bound GET for one durable handoff event. It returns the stored payload, delivery attempts, timestamps and last error, while omitting transient worker lease identifiers and performing no replay or mutation.
- Menu Planning tests now run serially because suite files share a local canonical-catalogue fixture and parallel runs can observe it while a test deliberately truncates it.
- Validation: focused diagnostic tests and serial full Menu Planning tests pass (601 passed, 5 skipped); typecheck and production build pass. Initial parallel workflow validation reproduced the shared-fixture race.
- Deployment: not deployed.
