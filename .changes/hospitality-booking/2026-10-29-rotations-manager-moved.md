# 2026-10-29 — Rotations authoring interface removed from Hospitality

`/rotations` no longer hosts the manager; it redirects to Menu Planning when `FIKA_MENU_PLANNING_URL` is configured, otherwise explains the move. The Hospitality proxy and the preview remain, and Hospitality continues to consume published rotations from the Hub unchanged.

Validation: Hospitality typecheck and rotation UI tests.
Deployment: none. `FIKA_MENU_PLANNING_URL` still has to be set per environment.
