# 2026-11-07 — Provisionable Calendar Scheduler identity

The Hub's fixed OIDC Scheduler identity now uses a Google Cloud service-account ID within the 30-character limit. The route continues to accept only a Google-signed token from the exact project-specific service account and fixed audience.

Validation: focused Scheduler OIDC auth test, Hub typecheck/build, changelog check, and exact-source merge-gate CI.
Deployment: pending governed production release; no Calendar event writes enabled.
