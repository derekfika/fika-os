# 2026-11-04 — Contain cached artifact links (#365)

Withhold cached Delivered-In days carrying artifact access pointers until the authenticated filtered API response arrives; keep ordinary cache hits and stored evidence unchanged. Requires the server containment in PR #366 in the same release candidate.

Validation: 15 focused cache and response-containment tests, Delivered-In typecheck and production build passed.
Deployment: none.
