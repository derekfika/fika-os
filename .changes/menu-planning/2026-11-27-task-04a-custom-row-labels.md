# 2026-11-27 — Task 04A custom row labels

During hosted staging acceptance, custom row names mapped to salad slot identities were being replaced by the canonical salad display labels. Explicit saved row names now take precedence while unchanged rows retain their owner-approved canonical labels. This preserves independent custom menu structure names in the weekly grid.

Responsibilities and source locations: `lib/week-planner-slot-label.ts` resolves explicit, canonical, and generic row labels; `app/week-planner.tsx` supplies saved custom row names; `tests/week-planner-layout.test.ts` covers precedence and blank-name fallback.

Validation: row-label precedence regression passed; full Menu Planning suite passed (604 passed, 5 skipped), typecheck and production build passed; PR #739 exact-source `Workflow / merge-gate` passed. Hosted acceptance confirmed that edited, duplicated, renamed and archived templates do not alter the saved Breakfast instance, Main Lunch remains unchanged, and the custom row labels render after reload. Deployment: Menu Planning staging, PR #739 source `cdc365be24392e79f7d1d03fca9bc9dd14755e55`, build `build-2026-11-27-002`, succeeded at 100%; no production deployment.
