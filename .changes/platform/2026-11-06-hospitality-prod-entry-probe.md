# 2026-11-06 — Verify the Hospitality production workspace entry

Use the strict Hospitality workspace probe in production as well as staging. The backend must return an exact HTTP 307 to `/workspace`, and that page must return HTTP 200. A different redirect or an unhealthy workspace fails verification.

Validation: all 24 release tests passed, including staging and production redirect cases. Read-only smoke passed on the current production backend.
Deployment: tooling only. No Hospitality rollout or data change.
