# 2026-11-20 — Activate verified Studio publications in Hub

Receive immutable Studio packages over the staging-only service interface. Require an independently authorised, bound operator to activate a package at the approved site. Collection activation uses its own AUTHMOD resource. Hub verifies the current CPU evidence before activation and again when resolving an event-date choice.

Validation: two isolated Firestore tests, Hub typecheck and build, and exact-source CI.
Deployment: none. The Hub pilot is disabled by default.
