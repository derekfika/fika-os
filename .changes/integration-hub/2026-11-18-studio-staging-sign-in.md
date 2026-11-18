# 2026-11-18 — Sign in to Studio preview through the staging Hub

Add a staging-only sign-in and access check for already-bound AUTHMOD people with a direct Studio assignment and View grant. Require the current access package and exact Hub and Studio origins. Rejected Studio intents stop before the general sign-in path.

Validation: focused AUTHMOD and session tests, isolated Firestore tests, typecheck and build.
Deployment: none. Registry and viewer grants are pending.
