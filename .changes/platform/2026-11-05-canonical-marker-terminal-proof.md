# 2026-11-05 Require completion proof for later release intents

During canonical deploy-marker recovery, require every later PENDING intent on an affected ledger to have its own matching terminal record, preventing an unrelated newer terminal head from concealing ambiguous release state.

Validation: focused positive and negative regressions pending; exact-source CI pending.
Deployment: none.
