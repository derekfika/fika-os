# 2026-11-04 — Hold unverified staging group-quote Drive access

The shared Drive token provider blocks Hub staging group-quote Drive access until the staging destination and ACL boundary is verified. Production and local token paths are unchanged.

Validation: focused group-quote/Drive routing tests 15 passed, one Firestore emulator test skipped; Hub typecheck and build passed. No Drive writes were performed.
Deployment: none.
