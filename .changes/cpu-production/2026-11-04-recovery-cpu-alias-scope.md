# 2026-11-04 — Preserve governed aliases in CPU destination scope

CPU can resolve historical governed destination IDs through the existing bounded Hub reference endpoint before site filtering. Only aliases whose authoritative target is already permitted are admitted; one-offs still require explicit global scope. Source IDs and historical evidence are unchanged. The existing server credential reads references without granting the user new authority. Global and known canonical paths add no reference reads; unresolved site IDs use request-coalesced batches of at most 100, with no new persistent audit writes or scans.

Validation: 24 focused alias, scope, admission and recovery regressions passed; CPU typecheck/build passed in the isolated follow-up workspace. Independent read-only review found no material blocker. Exact-source CI pending.
Deployment: not deployed; accompanies the separately reviewed CPU route guards for #344.
