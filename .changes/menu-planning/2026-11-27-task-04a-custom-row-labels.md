# 2026-11-27 — Task 04A custom row labels

During hosted staging acceptance, custom row names mapped to salad slot identities were being replaced by the canonical salad display labels. Explicit saved row names now take precedence while unchanged rows retain their owner-approved canonical labels. This preserves independent custom menu structure names in the weekly grid.

Responsibilities and source locations: `lib/week-planner-slot-label.ts` resolves explicit, canonical, and generic row labels; `app/week-planner.tsx` supplies saved custom row names; `tests/week-planner-layout.test.ts` covers precedence and blank-name fallback.

Validation: focused row-label regression, affected Menu Planning tests, typecheck and build pending. Deployment: staging acceptance in progress; no production deployment.
