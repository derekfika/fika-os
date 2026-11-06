# 2026-11-06 — Carry pending one-off routing through fulfilment

The scoped Menu destination contract distinguishes a pending address from a confirmed snapshot. Fulfilment preserves the existing order identity and exposes pending routing until Logistics confirms it.

Validation: Hub, Menu, CPU, Delivered-In and Logistics typechecks and the isolated Firestore handoff passed.
Deployment: pending governed release.
