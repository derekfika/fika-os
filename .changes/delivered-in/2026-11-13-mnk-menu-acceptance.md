# 2026-11-13 — MNK menu generation acceptance

Recognize the published HOT MAIN slot as a hot main in the existing menu renderer. After saving a generated menu, refresh the scoped derived day projection before returning success so normal dashboard reloads expose its View menu link. Publication, quantities, CPU signatures and authentication are unchanged.

Validation: Delivered-In tests 217/217, focused menu adapter tests 8/8, typecheck and build pass; governed CI pending. The first production menu was generated through the normal interface and opened under mnk@fikacatering.com; acceptance exposed these rendering and derived-refresh issues. A renderer revision creates a distinct artifact while retaining the same signed source identity.

Deployment: Pending governed production release.
