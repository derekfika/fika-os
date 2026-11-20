# 2026-11-20 â€” Reliable RCoA Calendar delivery after CPU handoff

- Hub commits live RCoA Calendar obligations with the production event even when Calendar writes are paused. The command reports CPU and Calendar outcomes independently.
- Immediate publication and Scheduler retries use the same deterministic obligation. The worker verifies the current booking and order, CPU confirmation, canonical OPLOC, organiser binding and approved PDF access. Historical obligations stay outside automatic retry.
- Delivery records retain a safe failure code and emit structured errors for operations. Staging remains unable to publish external invitations.
Validation: Focused Calendar and projection tests, Hub typecheck, and an isolated Firestore test for atomic staging, retry scope and replay preservation passed.
Deployment: Hub production release pending protected CI.
