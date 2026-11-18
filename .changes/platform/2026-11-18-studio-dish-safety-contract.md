# 2026-11-18 — Bind Studio food-safety evidence to dish revisions

The Studio and CPU apps share a versioned review source and a current, exact-revision safety reference. CPU owns signing events and releases. Studio reads minimal verification metadata. The route has no recurring reads and never sends work to bookings, Logistics or Delivered-In.

Validation: Studio and CPU typechecks, builds and isolated Firestore tests. Deployment: none.
