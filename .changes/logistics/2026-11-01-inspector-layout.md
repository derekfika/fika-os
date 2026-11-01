# 2026-11-01 — Logistics inspector panel layout (#120)

Consolidates the Details inspector's duplicate width and padding overrides so the intended 410px panel applies, gives the collection toggle its own spaced block so it no longer collides with the metadata rows below, and lets the assignment controls (run chooser, lane, time and window inputs) shrink inside the panel instead of clipping at its edge. CSS only; no behaviour, data or routing change.

Validation: `desktop-usability` and `run-planning` Playwright suites pass (66 tests across 1280–1920px and 100/125% zoom) against the workspace dev server. The exact unassigned-delivery view from staging (Bridgepoint, Delivered-In) needs live planner data and was not reproduced locally; confirm on staging after deploy.
Deployment: none. Staging deploy not requested.
