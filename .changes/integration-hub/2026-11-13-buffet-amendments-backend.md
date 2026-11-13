# 2026-11-13 — Price and validate buffet amendments

Material Hot Fork Buffet amendments on the ordinary standalone and grouped staff paths now resolve current canonical OPLOC offerings before saving. Submitted line prices cannot set the revised quote amount; the normal booking notice still applies. Buffet dietary counts are bounded by the amended guest count. Existing version, audit, immutable quote revision and explicit CPU replacement flows remain in charge. The group's unchanged-save fixture preserves its valid RCoA floor and room pair.

For standalone staging quotes, Hub records a saved PDF only after the existing isolated Drive provider verifies its runtime identity and the file is a non-trashed PDF inside the approved staging root. Hub derives the stored link from the verified file ID. Stored quote links remain redacted in staging; grouped quote generation and Calendar quote redirects remain held. Production behavior is unchanged. This code does not enable the isolated Drive identity or change Drive/IAM configuration.

Validation: full Hub unit suite (1,075 passed, 124 skipped); focused buffet selection and staging quote containment tests; dedicated isolated Firestore emulator suite (48 passed, one skipped), including standalone/group amendment and replay; Hub typecheck and build. No migration or operational writes.

Deployment: none.
