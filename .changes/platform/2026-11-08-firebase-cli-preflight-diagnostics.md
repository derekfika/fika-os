# 2026-11-08 — Firebase CLI preflight diagnostics

Fix the governed Firebase CLI preflight to report sanitized command errors instead of treating every failure as an expired interactive login. Local Firebase sessions and hosted Application Default Credentials remain supported.

Validation: Focused local-session, hosted ADC/WIF, and credential-redaction regression tests pass. Full governed workflow validation pending.
Deployment: none.
