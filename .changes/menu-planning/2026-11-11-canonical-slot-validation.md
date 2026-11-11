# 2026-11-11 — Accept the canonical Week Planner slot contract

Week-save slot validation now accepts the exact 29 canonical placement IDs used by Week Planner, while retaining the existing governed generated-slot rules and rejecting unknown IDs. No legacy week migration is needed: the affected placement strings are valid canonical IDs already carried by the week and entry schema. Saving continues to update Menu Planning draft state only; it does not publish or hand work to CPU.

Complexity: High. Recommended model: Sol. Reason: save-boundary correctness for operational menu data and preservation of an existing 95-entry browser draft.

Validation: focused save/draft/duplicate tests passed (47); governed workflow tests passed (163); Menu Planning tests passed (550 of 554, with 4 skipped); typecheck and production build passed. PR CI and staging rollout pending. Production deployment: not authorized; requires owner approval.
