# 2026-11-09 — Retire the spent RCoA Calendar catch-up approval

Remove the one-time catch-up approval after the approved event and its reconciliation checkpoint were verified. The recurring RCoA Calendar worker continues under the existing site and OIDC controls.

Validation: Google Calendar readback, exact checkpoint, Scheduler HTTP 200 and duplicate check verified before cleanup. Source diff and changelog checks passed.
Deployment: production rollout pending exact-source validation.
