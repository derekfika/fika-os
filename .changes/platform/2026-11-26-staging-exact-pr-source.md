# 2026-11-26 — Pin the validated PR head for a staging deployment

An explicit forward staging deployment can use a PR head that passed the required CI check. The release CLI verifies the protected main merge, its parents and the full repository tree, then records the merge SHA separately. The head SHA remains the source for submission, recovery and serving verification.

Validation: All 70 release execution, release policy, validation and retry tests passed. Isolated Git and simulated rollout tests covered an eligible head, source and merge identity, rejected provenance and CI, production exclusion and recovery. JavaScript syntax checks passed.

Deployment: none.
