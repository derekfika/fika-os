# 2026-11-13 — MNK site menu generation authentication

- Date: 2026-11-13
- Task: P0 — MNK Delivered-In site menu generation
- Summary: Allow the normal site-menu action only for the caller's existing Delivered-In Manage grant and active OPLOC scope, require the selected active site and current CPU-signed publication, retain maintenance authentication on reconciliation, and display backend error details in the UI. No AUTHMOD grants, menu source data, CPU signatures, or Drive permissions were changed.
Validation: Delivered-In tests (216/216), typecheck and production build passed; Integration Hub AUTHMOD tests (33/33), typecheck and production build passed. Production UI journey was not available because the authenticated browser session could not be opened.

Deployment: Not deployed. Production Drive owner and approved output-folder configuration are absent; no menu artifact was written.
