# 2026-11-07 — Scope Beverage authority to explicit OPLOC grants

Require direct Beverage app admission and exact resource, action and active canonical OPLOC grants. Keep generic site access and other applications unchanged. Validate the bounded scope through the existing audited admin command and document the isolated staging View procedure.

Validation: 1,021 Hub tests and 46 loopback Firestore tests passed. 120 unit tests and one emulator test were conditionally skipped. Typecheck and production build passed. Tests exercised the existing account command with 100 canonical sites, one audit event and zero generic site assignments. The existing Hub dependency audit findings remain open.

Deployment: None. Registry provisioning, grants and hosted activation remain separate governed actions.
